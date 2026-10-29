// Vectorizado preciso por objetos y por color (como una separación de serigrafía):
// 1) la IA detecta cada elemento (recuadro ajustado, paleta plana, orden de apilado) y la paleta del fondo;
// 2) cada recuadro se recorta y la IA lo redibuja "apto para vector" (colores sólidos exactos, bordes nítidos);
// 3) cada objeto se separa en imágenes de UN solo color (negro sobre blanco), en alta resolución y sólo con
//    los colores permitidos; cada una se vectoriza por separado conservando hasta el detalle más chico;
// 4) cada vector se pinta con su color exacto y se superpone en su lugar (fondo abajo, objetos arriba).
// El fondo se separa del ORIGINAL (no se redibuja: no se inventan dibujos) y se rellena debajo de los objetos.
import { blobToCanvas, cropBox, fitToRatio, getImageData, intersect, makeCanvas, type Img } from "../image";
import { askVision, makeImage } from "../imaging";
import { normalizeBox, normalizeHex, parseModelJson } from "../schema";
import type { Settings } from "../settings";
import { VECTOR_PLAN_SYSTEM, vectorPlanPrompt, vectorPrepBackgroundPrompt, vectorPrepObjectPrompt } from "../tool-prompts";
import type { Box } from "../types";
import { layersMarkup, traceQuantized, tracedToSvg, type Traced } from "./engine";
import { quantize, type Quantized } from "./quantize";

export type ObjStatus = "pendiente" | "preparando" | "vectorizando" | "listo" | "error";

/** Una separación: la imagen de un solo color (miniatura negro sobre blanco) y su color final. */
export interface Separation {
  color: string;
  thumb: string;
  /** Porcentaje del objeto que ocupa este color. */
  pct: number;
}

export interface VecObject {
  id: string;
  name: string;
  kind: string;
  text: string;
  box: Box;
  /** Paleta permitida (de la IA). Sólo estos colores pueden aparecer en el vector. */
  colors: string[];
  /** Colores que el usuario desactivó porque no van. */
  off?: string[];
  z: number;
  status: ObjStatus;
  since?: number;
  error?: string;
  /** Imagen preparada por la IA (se guarda en la caché: no se vuelve a pagar al retocar). */
  prep?: Blob;
  traced?: Traced;
  seps?: Separation[];
}

export interface VecPlan {
  width: number;
  height: number;
  background: { type: "transparent" | "solid" | "complex"; color: string | null; colors: string[] };
  objects: VecObject[];
}

export type BgSource = "original" | "ia";

/** Lado mayor de cada imagen de un color: alta resolución para no perder detalles chicos. */
const TRACE_SIDE = 2400;

export async function planObjects(settings: Settings, image: Blob, width: number, height: number, signal?: AbortSignal): Promise<VecPlan> {
  const raw = await askVision(settings, {
    tool: "vectorizador",
    operation: "analizar",
    image,
    system: VECTOR_PLAN_SYSTEM,
    prompt: vectorPlanPrompt(),
    signal,
  });
  const j = parseModelJson(raw) as {
    background?: { type?: string; color?: string; colors?: unknown[] };
    objects?: { name?: string; kind?: string; text?: string; box?: unknown; colors?: unknown[]; z?: number }[];
  };
  const hexList = (v: unknown[] | undefined) => [...new Set((v ?? []).map(normalizeHex).filter((c): c is string => !!c))].slice(0, 8);
  const type = (["transparent", "solid", "complex"] as const).find((t) => t === j.background?.type) ?? "transparent";
  const bgColors = hexList(j.background?.colors);
  const objects: VecObject[] = (j.objects ?? [])
    .map((o, i) => ({ o, i, box: normalizeBox(o.box) }))
    .filter((x): x is typeof x & { box: Box } => !!x.box)
    .slice(0, 14)
    .map(({ o, i, box }) => ({
      id: `o${i + 1}`,
      name: String(o.name ?? `Elemento ${i + 1}`).slice(0, 60),
      kind: String(o.kind ?? "shape"),
      text: String(o.text ?? ""),
      box,
      colors: hexList(o.colors),
      z: Number.isFinite(Number(o.z)) ? Number(o.z) : i,
      status: "pendiente" as ObjStatus,
    }));
  if (type === "complex") {
    objects.push({ id: "fondo", name: "Fondo", kind: "fondo", text: "", box: [0, 0, 1, 1], colors: bgColors, z: -1, status: "pendiente" });
  }
  if (!objects.length) {
    // Sin objetos detectados: se trata la imagen entera como un único elemento.
    objects.push({ id: "o1", name: "Arte completo", kind: "illustration", text: "", box: [0, 0, 1, 1], colors: [], z: 0, status: "pendiente" });
  }
  objects.sort((a, b) => a.z - b.z);
  return { width, height, background: { type, color: normalizeHex(j.background?.color), colors: bgColors }, objects };
}

/** ¿Este objeto necesita que la IA lo prepare? El fondo tomado del original no. */
export const needsPrep = (o: VecObject, bgSource: BgSource) => !(o.kind === "fondo" && bgSource === "original");

/** Recorta el objeto y pide a la IA la versión "apta para vector". */
export async function prepareObject(settings: Settings, src: Img, plan: VecPlan, o: VecObject, signal?: AbortSignal): Promise<Blob> {
  const isBg = o.kind === "fondo";
  const crop = cropBox(src, o.box, { margin: isBg ? 0 : 0.08 });
  const ref = await new Promise<Blob>((res) => crop.canvas.toBlob((b) => res(b!), "image/png"));
  const foreground = plan.objects.filter((x) => x.kind !== "fondo").map((x) => x.name);
  // Elementos vecinos que se superponen: la IA debe borrarlos por completo (van en su propia capa).
  const others = plan.objects
    .filter((x) => x !== o && x.kind !== "fondo" && intersect(x.box, o.box))
    .map((x) => `${x.kind} "${x.name}"${x.text ? ` (text "${x.text}")` : ""}`);
  return makeImage(settings, {
    tool: "vectorizador",
    operation: "editar",
    prompt: isBg ? vectorPrepBackgroundPrompt(o.colors, foreground) : vectorPrepObjectPrompt(o, others),
    refs: [ref],
    ratio: crop.canvas.width / crop.canvas.height,
    transparent: !isBg,
    signal,
  });
}

// ---------- utilidades de imagen ----------

/** Recorte exacto a lo visible (alfa ≥ 50 %) para ubicar el objeto con precisión. */
function tightCrop(c: HTMLCanvasElement): HTMLCanvasElement {
  const d = getImageData(c);
  const { width: w, height: h, data: p } = d;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (p[(y * w + x) * 4 + 3] >= 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return c;
  const [o, ctx] = makeCanvas(maxX - minX + 1, maxY - minY + 1);
  ctx.drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/**
 * Lleva la imagen a alta resolución con interpolación suave: al separar después por color, los bordes
 * quedan con precisión de subpíxel y las líneas finas o puntos chicos no se pierden.
 */
function toTraceSize(src: Img, w0 = src.width, h0 = src.height): HTMLCanvasElement {
  const k = TRACE_SIDE / Math.max(w0, h0);
  const [o, ctx] = makeCanvas(w0 * k, h0 * k);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w0, h0, 0, 0, o.width, o.height);
  return o;
}

/** Miniatura de una separación: la imagen de un solo color, negro sobre blanco. */
function separationThumb(q: Quantized, color: number): string {
  const W = 120;
  const k = W / Math.max(q.width, q.height);
  const tw = Math.max(1, Math.round(q.width * k)), th = Math.max(1, Math.round(q.height * k));
  const [c, ctx] = makeCanvas(tw, th);
  const img = ctx.createImageData(tw, th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const l = q.labels[Math.min(q.height - 1, Math.floor(y / k)) * q.width + Math.min(q.width - 1, Math.floor(x / k))];
      const v = l === color ? 0 : 255;
      const o = (y * tw + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

/** Silueta de los objetos ya vectorizados, en el espacio del fondo (para rellenar debajo de ellos). */
async function objectsSilhouette(plan: VecPlan, w: number, h: number): Promise<Uint8Array | null> {
  const fg = { ...plan, background: { ...plan.background, type: "transparent" as const }, objects: plan.objects.filter((o) => o.kind !== "fondo" && o.traced) };
  if (!fg.objects.length) return null;
  const url = URL.createObjectURL(new Blob([composeSvg(fg, false)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const [, ctx] = makeCanvas(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const a = ctx.getImageData(0, 0, w, h).data;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 20 ? 1 : 0;
    return dilate(m, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.003)));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Dilatación binaria separable (ventana deslizante), O(n) por pasada. */
function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = -r; x < w; x++) {
      if (x + r < w) count += m[y * w + x + r];
      if (x - r - 1 >= 0) count -= m[y * w + x - r - 1];
      if (x >= 0) tmp[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -r; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      if (y >= 0) out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Rellena las zonas tapadas con el color de fondo que las rodea (propagación desde el borde). */
function inpaint(labels: Int16Array, hole: Uint8Array, w: number, h: number) {
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let i = 0; i < labels.length; i++) {
    if (hole[i]) {
      labels[i] = -2;
      continue;
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === -2) continue;
    const x = i % w;
    if ((x > 0 && labels[i - 1] === -2) || (x < w - 1 && labels[i + 1] === -2) || (i >= w && labels[i - w] === -2) || (i < w * (h - 1) && labels[i + w] === -2)) queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const v = labels[i];
    const push = (j: number) => {
      if (labels[j] === -2) {
        labels[j] = v;
        queue[tail++] = j;
      }
    };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < labels.length; i++) if (labels[i] === -2) labels[i] = -1;
}

// ---------- separación y trazado ----------

export interface TraceContext {
  /** Imagen original (para el fondo tomado del original). */
  source: Img;
  bgSource: BgSource;
}

/**
 * Separa el objeto en imágenes de un solo color y vectoriza cada una.
 * Devuelve el vector apilado (sin rendijas) y las miniaturas de cada separación.
 */
export async function traceObject(plan: VecPlan, o: VecObject, detail: number, maxColors: number, tc: TraceContext): Promise<{ traced: Traced; seps: Separation[] }> {
  const isBg = o.kind === "fondo";
  let c: HTMLCanvasElement;
  if (isBg && tc.bgSource === "original") c = toTraceSize(tc.source);
  else {
    if (!o.prep) throw new Error("Falta la imagen preparada.");
    let p = await blobToCanvas(o.prep);
    p = isBg ? fitToRatio(p, (o.box[2] * plan.width) / (o.box[3] * plan.height)) : tightCrop(p);
    c = toTraceSize(p);
  }
  // Sólo los colores permitidos (menos los que el usuario apagó). Sin paleta, se detecta sola.
  const allowed = o.colors.filter((x) => !o.off?.includes(x));
  const fromOriginal = isBg && tc.bgSource === "original";
  const base = { lightWeight: 0.55, denoise: fromOriginal || isNoisy(c) };
  const q = quantize(getImageData(c), allowed.length ? { ...base, maxColors: allowed.length, hints: allowed, strict: true } : { ...base, maxColors: Math.min(maxColors, 8) });
  if (isBg) {
    const hole = await objectsSilhouette(plan, q.width, q.height);
    if (hole) {
      inpaint(q.labels, hole, q.width, q.height);
      q.areas.fill(0);
      for (const l of q.labels) if (l >= 0) q.areas[l]++;
    }
  }
  const total = q.areas.reduce((a, b) => a + b, 0) || 1;
  const seps = q.palette
    .map((color, i) => ({ color, i, area: q.areas[i] }))
    .filter((x) => x.area > 0)
    .sort((a, b) => b.area - a.area)
    .map((x) => ({ color: x.color, thumb: separationThumb(q, x.i), pct: (x.area / total) * 100 }));
  return { traced: await traceQuantized(q, detail), seps };
}

/** Superpone todo en el lienzo original: escala uniforme, centrado en su recuadro, fondo abajo. */
export function composeSvg(plan: VecPlan, keepBackground: boolean): string {
  const { width: W, height: H } = plan;
  const parts: string[] = [];
  if (keepBackground && plan.background.type === "solid" && plan.background.color) {
    parts.push(`<rect width="${W}" height="${H}" fill="${plan.background.color}"/>`);
  }
  for (const o of plan.objects) {
    if (!o.traced || (o.kind === "fondo" && !keepBackground)) continue;
    const t = o.traced;
    const bx = o.box[0] * W, by = o.box[1] * H, bw = o.box[2] * W, bh = o.box[3] * H;
    const s = o.kind === "fondo" ? bw / t.width : Math.min(bw / t.width, bh / t.height);
    const tx = bx + (bw - t.width * s) / 2;
    const ty = by + (bh - t.height * s) / 2;
    parts.push(`<g id="${o.id}" data-name="${escapeAttr(o.name)}" transform="translate(${r(tx)} ${r(ty)}) scale(${s.toFixed(6)})">${layersMarkup(t.layers)}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

const r = (v: number) => Math.round(v * 100) / 100;
const escapeAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Miniatura de la imagen preparada (para la lista de objetos). */
export async function prepThumb(b: Blob): Promise<string> {
  const c = await blobToCanvas(b);
  const k = 160 / Math.max(c.width, c.height);
  const [t, ctx] = makeCanvas(c.width * k, c.height * k);
  ctx.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/png");
}

/**
 * Vectoriza un arte ya limpio (recreado por la IA, generado o subido) separándolo por color:
 * paleta estricta (los colores dados, o pocos dominantes si no hay), una imagen de un solo color por
 * cada uno en alta resolución, trazado por separado y apilado sin rendijas.
 */
export async function vectorizeArtwork(
  image: Blob,
  opts: { palette?: string[]; detail?: number; maxColors?: number; noisy?: boolean },
): Promise<{ svg: string; seps: Separation[] }> {
  const src = await blobToCanvas(image);
  const c = toTraceSize(src);
  const palette = [...new Set((opts.palette ?? []).map((x) => x.toLowerCase()))];
  const base = { lightWeight: 0.55, denoise: opts.noisy ?? isNoisy(c) };
  const q = quantize(getImageData(c), palette.length ? { ...base, maxColors: palette.length, hints: palette, strict: true } : { ...base, maxColors: opts.maxColors ?? 8 });
  const total = q.areas.reduce((a, b) => a + b, 0) || 1;
  const seps = q.palette
    .map((color, i) => ({ color, i, area: q.areas[i] }))
    .filter((x) => x.area > 0)
    .sort((a, b) => b.area - a.area)
    .map((x) => ({ color: x.color, thumb: separationThumb(q, x.i), pct: (x.area / total) * 100 }));
  const traced = await traceQuantized(q, opts.detail ?? 0.9);
  return { svg: tracedToSvg(traced, src.width, src.height), seps };
}

/** ¿Tiene grano/textura? Proporción de píxeles que difieren mucho de su vecino derecho. */
function isNoisy(c: HTMLCanvasElement): boolean {
  const d = getImageData(c).data;
  const w = c.width;
  let rough = 0, n = 0;
  for (let i = 0; i < d.length - 8; i += 4 * 7) {
    if (d[i + 3] < 128 || d[i + 7] < 128 || (i / 4) % w === w - 1) continue;
    const diff = Math.abs(d[i] - d[i + 4]) + Math.abs(d[i + 1] - d[i + 5]) + Math.abs(d[i + 2] - d[i + 6]);
    if (diff > 24 && diff < 200) rough++;
    n++;
  }
  return n > 0 && rough / n > 0.06;
}
