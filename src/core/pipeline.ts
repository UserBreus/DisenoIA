// Orquestación del Extractor: análisis → elementos → referencias → recreación → postproceso → herramientas.
import { getProduct, getSurface, surfaceLabel } from "./catalog";
import {
  area,
  blobToCanvas,
  canvasToBlob,
  concatHorizontal,
  cropBox,
  describePlace,
  encodeReference,
  fitToRatio,
  getImageData,
  imageDataToCanvas,
  intersect,
  makeCanvas,
  normalizeForAnalysis,
  solidPanel,
  union,
  type Img,
} from "./image";
import { CLIENT } from "./limits";
import { extractAlpha, flattenOnKey, hasAlpha, keyOut, restoreAlpha, trim } from "./matte";
import { ANALYSIS_SYSTEM, PROMPT_VERSION, analysisUserPrompt, backgroundPrompt, groupPrompt, objectPrompt, sleevePrompt, type ReferenceNotes } from "./prompts";
import { analysisProvider, imageProvider, toolsProvider } from "../providers";
import type { Settings } from "./settings";
import { tracked } from "./ops";
import { vectorizeArtwork } from "./vector/pipeline";
import { normalizeAnalysis, parseModelJson } from "./schema";
import { sha256 } from "./image";
import { uid } from "./queue";
import { ProviderError, type AnalysisResult, type ArtItem, type ArtVersion, type Box, type Extraction, type GroupMode } from "./types";

// ---------- análisis ----------

export async function analyzePhoto(ex: Extraction, bitmap: Img, settings: Settings, intent: string, signal?: AbortSignal): Promise<AnalysisResult> {
  const provider = analysisProvider(settings);
  const image = await normalizeForAnalysis(bitmap);
  return tracked(
    {
      intent,
      extractionId: ex.id,
      itemId: null,
      operation: "analizar",
      provider: provider.id,
      model: provider.model,
      inputHash: await sha256(image),
      promptVersion: PROMPT_VERSION,
    },
    async () => normalizeAnalysis(parseModelJson(await provider.ask({ image, system: ANALYSIS_SYSTEM, prompt: analysisUserPrompt(), signal, task: "analysis" }))),
  );
}

export function buildItems(analysis: AnalysisResult): ArtItem[] {
  const items: ArtItem[] = [];
  // Función (no objeto) para que cada elemento tenga su propio arreglo de versiones.
  const base = () => ({ selected: true, state: "detectado" as const, versions: [] as ArtVersion[], active: 0, enlargements: 0 });
  analysis.pieces.forEach((p, pi) => {
    p.backgrounds.forEach((bg, bi) => {
      items.push({
        ...base(),
        id: `fondo-${pi + 1}-${bi + 1}`,
        pieceId: p.id,
        kind: "fondo",
        name: bg.name || `Fondo ${surfaceLabel(p.productType, bg.surface)}`,
        boxes: bg.fragments.map((f) => f.box_2d),
        bg,
      });
    });
    p.objects.forEach((obj, oi) => {
      items.push({ ...base(), id: `obj-${pi + 1}-${oi + 1}`, pieceId: p.id, kind: obj.kind, name: obj.name, boxes: [obj.box_2d, ...(obj.more ?? [])], obj });
    });
  });
  return items;
}

/** Crea un elemento "grupo" a partir de varios objetos seleccionados. */
export function makeGroup(ex: Extraction, memberIds: string[], mode: GroupMode): ArtItem {
  const members = ex.items.filter((i) => memberIds.includes(i.id) && i.obj);
  if (members.length < 2) throw new Error("Elegí al menos dos objetos para agrupar.");
  return {
    id: uid("grupo-"),
    pieceId: members[0].pieceId,
    kind: "grupo",
    name: members.map((m) => m.name).join(" + "),
    boxes: [union(members.map((m) => m.obj!.box_2d))],
    selected: true,
    state: "detectado",
    group: { mode, memberIds: members.map((m) => m.id) },
    versions: [],
    active: 0,
    enlargements: 0,
  };
}

// ---------- referencias ----------

interface Prepared {
  refs: Blob[];
  main: HTMLCanvasElement;
  notes: ReferenceNotes;
  ratio: number;
  prompt: string;
  background: "transparent" | "opaque";
}

const pxRatio = (b: Box, img: Img) => (b[2] * img.width) / (b[3] * img.height);
const side = (s: string) => (/izquierd|left/i.test(s) ? "L" : /derech|right/i.test(s) ? "R" : "");

/** Objetos separados que tapan al objetivo: se cruzan con él y son más chicos (están encima). */
function occluders(ex: Extraction, target: Box, exclude: string[], pieceId: string): ArtItem[] {
  return ex.items.filter((i) => {
    if (!i.obj || i.pieceId !== pieceId || exclude.includes(i.id)) return false;
    const hit = intersect(i.obj.box_2d, target);
    return !!hit && area(i.obj.box_2d) < area(target);
  });
}

/** Descripción para la lista de cosas a quitar (el generador las borra y continúa el fondo). */
const describe = (i: ArtItem) =>
  `${i.obj!.kind} "${i.name}"${i.obj!.text.length ? ` (text ${i.obj!.text.map((t) => `"${t}"`).join(" / ")})` : ""}`;

async function toRef(c: HTMLCanvasElement, keyBackground: boolean): Promise<Blob> {
  const d = getImageData(c);
  if (!hasAlpha(d)) return encodeReference(c, false);
  // La referencia trae alfa: si el proveedor no lo admite, se aplana contra el color clave.
  return keyBackground ? encodeReference(imageDataToCanvas(flattenOnKey(d)), false) : encodeReference(c, true);
}

/**
 * Foto completa (lado mayor 1024 px) con el objetivo marcado en cian: le da a la IA el contexto de qué
 * es y dónde está, así no interpreta mal recortes chicos o borrosos.
 */
async function contextImage(img: Img, boxes: Box[]): Promise<Blob> {
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const [c, ctx] = makeCanvas(img.width * k, img.height * k);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = Math.max(2, Math.round(c.width / 320));
  for (const b of boxes) ctx.strokeRect(b[0] * c.width, b[1] * c.height, b[2] * c.width, b[3] * c.height);
  return canvasToBlob(c, "image/jpeg", 0.88);
}

/** ¿El fragmento de manga se ve desde el frente o desde la espalda de la prenda? */
const faceOf = (f: { face: string; view: string }): "front" | "back" | null => {
  const t = `${f.face} ${f.view}`.toLowerCase();
  if (/back|espalda|tras|posterior|costas/.test(t)) return "back";
  if (/front|frente|delant|anterior/.test(t)) return "front";
  return null;
};

/**
 * Prepara las referencias. No se tapan los objetos con gris: los modelos de edición actuales
 * conservan mejor la escena si ven la foto completa y reciben por nombre qué deben quitar.
 * Siempre va al final la foto entera con el objetivo marcado, como contexto.
 */
export async function prepare(item: ArtItem, ex: Extraction, img: Img, keyBackground: boolean, feedback: string | null): Promise<Prepared> {
  const piece = ex.analysis?.pieces.find((p) => p.id === item.pieceId);
  const productType = piece?.productType ?? "otro";

  if (item.bg) {
    const bg = item.bg;
    const surface = getSurface(productType, bg.surface, piece?.variant);
    const covered = union(bg.fragments.map((f) => f.box_2d));
    const remove = ex.items.filter((i) => i.obj && i.pieceId === item.pieceId && intersect(i.obj.box_2d, covered)).map(describe);

    // Manga: la parte vista de frente y la vista de espalda se unen en un panel completo.
    if (bg.surface.startsWith("manga")) {
      const front = bg.fragments.find((f) => faceOf(f) === "front") ?? bg.fragments.find((f) => faceOf(f) === null);
      const back = bg.fragments.find((f) => faceOf(f) === "back" && f !== front);
      const crops = [front, back].filter((f): f is NonNullable<typeof f> => !!f).map((f) => cropBox(img, f.box_2d));
      const refs = [...(await Promise.all(crops.map((c) => toRef(c.canvas, false)))), await contextImage(img, bg.fragments.map((f) => f.box_2d))];
      const notes: ReferenceNotes = { count: refs.length, aux: 0, context: true, keyBackground: false, remove };
      const side = bg.surface.endsWith("izquierda") ? "left" : "right";
      return {
        refs,
        main: crops[0].canvas,
        notes,
        ratio: surface.ratio,
        prompt: sleevePrompt(bg, productType, piece?.variant ?? null, side, { front: !!front, back: !!back }, notes, feedback),
        background: "opaque",
      };
    }

    const crops = bg.fragments.slice(0, 1 + CLIENT.extraCrops).map((f, i) => {
      const flip = i > 0 && side(f.face || f.view) !== "" && side(f.face || f.view) !== side(bg.surface);
      return cropBox(img, f.box_2d, { mirror: flip });
    });
    const refsCanvases = [crops[0].canvas];
    if (crops.length > 2) refsCanvases.push(concatHorizontal(crops.slice(1).map((c) => c.canvas)));
    else if (crops.length === 2) refsCanvases.push(crops[1].canvas);
    const refs = [...(await Promise.all(refsCanvases.map((c) => toRef(c, false)))), await contextImage(img, bg.fragments.map((f) => f.box_2d))];
    const notes: ReferenceNotes = { count: refs.length, aux: refsCanvases.length - 1, context: true, keyBackground: false, remove };
    return {
      refs,
      main: crops[0].canvas,
      notes,
      ratio: surface.ratio,
      prompt: backgroundPrompt(bg, productType, piece?.variant ?? null, notes, feedback),
      background: "opaque",
    };
  }

  if (item.group) {
    const members = ex.items.filter((i) => item.group!.memberIds.includes(i.id) && i.obj);
    if (!members.length) throw new ProviderError("missing_reference", "El grupo no tiene integrantes.");
    const whole = union(members.map((m) => m.obj!.box_2d));
    const ctxImg = await contextImage(img, [whole]);
    if (item.group.mode === "posicion") {
      const crop = cropBox(img, whole);
      const notes: ReferenceNotes = { count: 2, aux: 0, context: true, keyBackground, remove: occluders(ex, whole, item.group.memberIds, item.pieceId).map(describe) };
      const ratio = pxRatio(whole, img);
      return {
        refs: [await toRef(crop.canvas, keyBackground), ctxImg],
        main: crop.canvas,
        notes,
        ratio,
        prompt: groupPrompt(members.map((m) => ({ art: m.obj!, place: describePlace(m.obj!.box_2d, whole) })), "posicion", ratio, notes, feedback),
        background: "transparent",
      };
    }
    const crops = members.map((m) => cropBox(img, m.obj!.box_2d));
    const strip = concatHorizontal(crops.map((c) => c.canvas));
    const remove = [...new Set(members.flatMap((m) => occluders(ex, m.obj!.box_2d, item.group!.memberIds, item.pieceId).map(describe)))];
    const notes: ReferenceNotes = { count: 2, aux: 0, context: true, keyBackground, remove };
    const ratio = members.reduce((s, m) => s + (m.obj!.aspect ?? pxRatio(m.obj!.box_2d, img)), 0);
    return {
      refs: [await toRef(strip, keyBackground), ctxImg],
      main: strip,
      notes,
      ratio,
      prompt: groupPrompt(members.map((m, i) => ({ art: m.obj!, place: `position ${i + 1} from the left` })), "lado_a_lado", ratio, notes, feedback),
      background: "transparent",
    };
  }

  const obj = item.obj!;
  // Partes del mismo elemento vistas en otras vistas (p. ej. un sponsor que rodea la manga).
  const more = obj.more ?? [];
  const crop = cropBox(img, obj.box_2d);
  const partCrops = more.map((b) => cropBox(img, b));
  const refs = [
    await toRef(crop.canvas, keyBackground),
    ...(await Promise.all(partCrops.map((c) => toRef(c.canvas, keyBackground)))),
    await contextImage(img, [obj.box_2d, ...more]),
  ];
  const notes: ReferenceNotes = { count: refs.length, aux: partCrops.length, context: true, keyBackground, remove: occluders(ex, obj.box_2d, [item.id], item.pieceId).map(describe) };
  const ratio = obj.aspect ?? (more.length ? pxRatio(obj.box_2d, img) * 1.6 : pxRatio(obj.box_2d, img));
  return {
    refs,
    main: crop.canvas,
    notes,
    ratio,
    prompt: objectPrompt(obj, ratio, notes, piece?.garmentColor ?? null, feedback),
    background: "transparent",
  };
}

/** Recorte principal para la comparación "antes". */
export function previewCrop(item: ArtItem, img: Img): HTMLCanvasElement {
  const box = item.boxes.length > 1 ? item.boxes[0] : item.boxes[0] ?? [0, 0, 1, 1];
  return cropBox(img, box, { margin: 0.05 }).canvas;
}

// ---------- recreación ----------

export async function recreate(item: ArtItem, ex: Extraction, img: Img, settings: Settings, feedback: string | null, intent: string, signal?: AbortSignal): Promise<ArtVersion> {
  const piece = ex.analysis?.pieces.find((p) => p.id === item.pieceId);
  const productType = piece?.productType ?? "otro";

  // Fondo liso: se genera localmente, sin costo ni IA.
  if (item.bg?.plain && !feedback) {
    const surface = getSurface(productType, item.bg.surface, piece?.variant);
    const color = item.bg.colors[0] ?? piece?.garmentColor ?? "#ffffff";
    return version(await canvasToBlob(solidPanel(color, surface.ratio)), "local", "color-liso", null);
  }

  const provider = imageProvider(settings);
  const transparentTarget = !item.bg;
  const keyBackground = transparentTarget && !provider.transparency;
  const prep = await prepare(item, ex, img, keyBackground, feedback);
  const refHashes = await Promise.all(prep.refs.map((r) => sha256(r)));

  const out = await tracked(
    {
      intent,
      extractionId: ex.id,
      itemId: item.id,
      operation: "recrear",
      provider: provider.id,
      model: provider.model,
      inputHash: await sha256(prep.prompt + refHashes.join("")),
      promptVersion: PROMPT_VERSION,
    },
    () => provider.recreate({ prompt: prep.prompt, references: prep.refs, ratio: prep.ratio, background: prep.background, signal }),
  );

  let canvas = await blobToCanvas(out.image);
  if (transparentTarget) {
    let d = getImageData(canvas);
    if (!out.nativeAlpha || !hasAlpha(d)) d = keyOut(d);
    canvas = imageDataToCanvas(trim(d));
  } else if (getProduct(productType).exactRatio) {
    canvas = fitToRatio(canvas, prep.ratio);
  }
  return version(await canvasToBlob(canvas), provider.id, provider.model, feedback);
}

const version = (png: Blob, provider: string, model: string, feedback: string | null): ArtVersion => ({
  id: uid("v-"),
  png,
  feedback,
  provider,
  model,
  promptVersion: PROMPT_VERSION,
  createdAt: Date.now(),
});

// ---------- herramientas de producción ----------

export async function upscale(ex: Extraction, item: ArtItem, v: ArtVersion, settings: Settings, intent: string, signal?: AbortSignal): Promise<Blob> {
  const tools = toolsProvider(settings);
  const src = await blobToCanvas(v.png);
  const d = getImageData(src);
  const alpha = hasAlpha(d) ? extractAlpha(d) : null;
  // Los servicios remotos suelen perder el alfa: se envía aplanado y luego se restaura interpolado.
  const input = alpha && tools.id !== "local" ? await canvasToBlob(imageDataToCanvas(flattenOnKey(d))) : v.png;
  const result = await tracked(
    { intent, extractionId: ex.id, itemId: item.id, operation: "ampliar", provider: tools.id, model: tools.id, inputHash: await sha256(input), promptVersion: null },
    () => tools.upscale(input, signal),
  );
  if (!alpha || tools.id === "local") return result;
  const big = getImageData(await blobToCanvas(result));
  return canvasToBlob(imageDataToCanvas(restoreAlpha(big, alpha)));
}

export async function vectorize(ex: Extraction, item: ArtItem, v: ArtVersion, settings: Settings, intent: string, signal?: AbortSignal): Promise<string> {
  const tools = toolsProvider(settings);
  const input = v.enlarged ?? v.png;
  // Paleta del análisis: sólo esos colores pueden aparecer (para grupos, la de todos sus integrantes).
  const members = item.group ? ex.items.filter((i) => item.group!.memberIds.includes(i.id)) : [item];
  const palette = members.flatMap((m) => m.obj?.colors ?? m.bg?.colors ?? []);
  return tracked(
    { intent, extractionId: ex.id, itemId: item.id, operation: "vectorizar", provider: tools.id, model: tools.id, inputHash: await sha256(input), promptVersion: null },
    async () =>
      tools.id === "local" ? (await vectorizeArtwork(input, { palette, noisy: item.kind === "fondo" ? undefined : false })).svg : tools.vectorize(input, signal),
  );
}

export async function cutout(ex: Extraction, item: ArtItem, v: ArtVersion, settings: Settings, intent: string, signal?: AbortSignal): Promise<Blob> {
  const tools = toolsProvider(settings);
  const result = await tracked(
    { intent, extractionId: ex.id, itemId: item.id, operation: "recortar", provider: tools.id, model: tools.id, inputHash: await sha256(v.png), promptVersion: null },
    () => tools.cutout(v.png, signal),
  );
  return canvasToBlob(imageDataToCanvas(trim(getImageData(await blobToCanvas(result)))));
}
