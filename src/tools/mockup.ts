// Mockup 3D: la estampa sobre camiseta, taza, banner o wind banner. Foto en alta y video 360°.
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { bindDrops, chips, dropzone, errorText, esc, onPaste, section } from "../app/ui";
import { canvasToBlob } from "../core/image";
import { download } from "../export";
import { toast } from "../ui/dom";
import { toolSession } from "../core/session";
import { MESHES, SHIRT_BOUNDS, Viewer, type ProductKind } from "./mockup-gl";

const PRODUCTS: { id: ProductKind; label: string }[] = [
  { id: "camiseta", label: "Camiseta" },
  { id: "taza", label: "Taza" },
  { id: "banner", label: "Banner" },
  { id: "wind", label: "Wind banner" },
];

const BACKGROUNDS = [
  { id: "negro", label: "Negro", rgba: [0.035, 0.035, 0.04, 1] },
  { id: "grafito", label: "Grafito", rgba: [0.11, 0.11, 0.12, 1] },
  { id: "claro", label: "Claro", rgba: [0.95, 0.95, 0.94, 1] },
  { id: "transparente", label: "Transparente", rgba: [0, 0, 0, 0] },
] as const;

/** Tamaño de la textura por producto (proporción del área imprimible). */
const TEX: Record<ProductKind, [number, number]> = { camiseta: [4096, 2048], taza: [3072, 1365], banner: [3072, 1024], wind: [1024, 2560] };

interface Print {
  img: ImageBitmap;
  name: string;
  /** Archivo original (para guardarlo en la caché y restaurarlo). */
  blob: Blob;
}

interface Placement {
  scale: number;
  x: number;
  y: number;
  full: boolean;
}

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const mount: Mount = (root, ctx) => {
  const s = {
    product: "camiseta" as ProductKind,
    color: "#f4f4f2",
    bg: "negro",
    side: "frente" as "frente" | "espalda",
    prints: {} as Record<string, Print | undefined>,
    place: { frente: { scale: 0.62, x: 0, y: 0.28, full: false }, espalda: { scale: 0.7, x: 0, y: 0.2, full: false } } as Record<string, Placement>,
    recording: false,
  };
  let viewer: Viewer | null = null;
  const tex = document.createElement("canvas");
  type Saved = { product: ProductKind; color: string; bg: string; side: "frente" | "espalda"; place: Record<string, Placement>; prints: Record<string, { blob: Blob; name: string } | undefined> };
  const session = toolSession<Saved>("mockup");
  const persist = () =>
    session.save({
      product: s.product,
      color: s.color,
      bg: s.bg,
      side: s.side,
      place: s.place,
      prints: Object.fromEntries(Object.entries(s.prints).map(([k, p]) => [k, p ? { blob: p.blob, name: p.name } : undefined])),
    });

  const slot = () => (s.product === "camiseta" ? s.side : "frente");

  /** Compone la textura: color base + estampa ubicada (o estampado completo). */
  function compose() {
    if (!viewer) return;
    const [W, H] = TEX[s.product];
    tex.width = W;
    tex.height = H;
    const g = tex.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    const draw = (p: Print | undefined, pl: Placement, x0: number, w: number, area: { x: number; y: number; w: number; h: number }) => {
      if (!p) return;
      g.save();
      g.beginPath();
      g.rect(x0, 0, w, H);
      g.clip();
      g.imageSmoothingQuality = "high";
      if (pl.full) {
        // Sublimación total: la imagen cubre todo el panel.
        const k = Math.max(w / p.img.width, H / p.img.height);
        g.drawImage(p.img, x0 + (w - p.img.width * k) / 2, (H - p.img.height * k) / 2, p.img.width * k, p.img.height * k);
      } else {
        const maxW = area.w * pl.scale;
        const maxH = area.h * pl.scale;
        const k = Math.min(maxW / p.img.width, maxH / p.img.height);
        const cx = area.x + area.w / 2 + pl.x * area.w * 0.5;
        const cy = area.y + area.h / 2 - pl.y * area.h * 0.5;
        g.drawImage(p.img, cx - (p.img.width * k) / 2, cy - (p.img.height * k) / 2, p.img.width * k, p.img.height * k);
      }
      g.restore();
    };
    if (s.product === "camiseta") {
      // Área del torso (sin mangas) dentro de cada mitad de la textura.
      const { minX, maxX, minY, maxY } = SHIRT_BOUNDS;
      const half = W / 2;
      const tx = (x: number) => ((x - minX) / (maxX - minX)) * half;
      const ty = (y: number) => (1 - (y - minY) / (maxY - minY)) * H;
      const torso = { x: tx(-0.62), y: ty(0.98), w: tx(0.62) - tx(-0.62), h: ty(-1.08) - ty(0.98) };
      draw(s.prints.frente, s.place.frente, 0, half, torso);
      const back = { ...torso, x: half + torso.x };
      draw(s.prints.espalda, s.place.espalda, half, half, back);
    } else {
      draw(s.prints.frente, s.place.frente, 0, W, { x: 0, y: 0, w: W, h: H });
    }
    viewer.setTexture(tex);
  }

  function setProduct(p: ProductKind) {
    s.product = p;
    if (p !== "camiseta") s.side = "frente";
    viewer?.setParts(MESHES[p]());
    if (viewer) {
      viewer.fabric = p === "taza" ? 0 : 1;
      viewer.dist = p === "banner" ? 5.2 : p === "wind" ? 5.8 : p === "camiseta" ? 5.1 : 4.6;
      if (p === "taza") s.color = "#ffffff";
      viewer.base = hexToRgb(s.color);
    }
    compose();
  }

  async function setPrint(blob: Blob, name: string) {
    try {
      const img = await createImageBitmap(blob);
      s.prints[slot()]?.img.close();
      s.prints[slot()] = { img, name, blob };
      compose();
      persist();
      renderSide();
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function photo() {
    if (!viewer) return;
    const { width, height } = viewer.canvas;
    viewer.resize(2400, Math.round((2400 * height) / Math.max(1, width)));
    viewer.draw();
    const blob = await canvasToBlob(viewer.canvas);
    viewer.resize();
    const name = `Mockup ${PRODUCTS.find((p) => p.id === s.product)!.label}`;
    await ctx.keep({ tool: "mockup", name, blob, meta: { product: s.product } });
    download(blob, `${name.toLowerCase().replace(/\s+/g, "-")}.png`);
    toast("Foto guardada en la biblioteca.", "ok");
  }

  /** Video 360°: una vuelta completa a 1080p capturando el canvas. */
  async function video() {
    if (!viewer || s.recording) return;
    const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return toast("Tu navegador no permite grabar video del canvas.");
    s.recording = true;
    renderSide();
    const v = viewer;
    v.auto = false;
    v.resize(1080, 1080);
    if (v.bg[3] === 0) v.bg = [...BACKGROUNDS[0].rgba] as [number, number, number, number];
    const stream = v.canvas.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    const start = performance.now();
    const yaw0 = v.yaw;
    await new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 6000);
        v.yaw = yaw0 + t * Math.PI * 2;
        v.invalidate();
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    v.bg = [...BACKGROUNDS.find((b) => b.id === s.bg)!.rgba] as [number, number, number, number];
    v.resize();
    s.recording = false;
    renderSide();
    download(new Blob(chunks, { type: type.split(";")[0] }), `mockup-360.${type.includes("mp4") ? "mp4" : "webm"}`);
  }

  function renderSide() {
    const side = root.querySelector(".tool-side");
    if (!side) return;
    const p = s.prints[slot()];
    const pl = s.place[slot()];
    side.innerHTML =
      section("Producto", chips("product", PRODUCTS, s.product)) +
      section(
        "Estampa",
        `${s.product === "camiseta" ? chips("side", [{ id: "frente", label: "Frente" }, { id: "espalda", label: "Espalda" }], s.side) : ""}
         ${
           p
             ? `<div class="print-row"><span class="print-name">${esc(p.name)}</span><button class="btn ghost sm" data-act="remove">${icon("borrar", 16)}</button></div>`
             : dropzone({ id: "print", title: "Soltá la estampa", hint: "PNG con transparencia ideal", compact: true })
         }
         <label class="toggle"><input type="checkbox" data-k="full" ${pl.full ? "checked" : ""}/> <span>Sublimación completa</span></label>
         ${
           pl.full
             ? ""
             : `<label class="field">Tamaño <b>${Math.round(pl.scale * 100)}%</b><input type="range" min="10" max="100" value="${Math.round(pl.scale * 100)}" data-k="scale"/></label>
                <label class="field">Horizontal<input type="range" min="-100" max="100" value="${Math.round(pl.x * 100)}" data-k="x"/></label>
                <label class="field">Vertical<input type="range" min="-100" max="100" value="${Math.round(pl.y * 100)}" data-k="y"/></label>`
         }`,
      ) +
      section(
        "Escena",
        `<label class="field row">Color del producto<input type="color" value="${s.color}" data-k="color"/></label>
         <span class="label">Fondo</span>${chips("bg", BACKGROUNDS, s.bg)}`,
      ) +
      section(
        "Exportar",
        `<button class="btn primary block" data-act="photo">${icon("camara", 16)} Foto en alta</button>
         <button class="btn block" data-act="video" ${s.recording ? "disabled" : ""}>${icon("video", 16)} ${s.recording ? "Grabando 360°…" : "Video 360°"}</button>`,
      );
    bindDrops(side as HTMLElement, (f) => setPrint(f, f.name.replace(/\.[^.]+$/, "")));
  }

  root.innerHTML = `
    <div class="tool">
      <section class="tool-main">
        <div class="stage3d ${s.bg === "transparente" ? "checker" : ""}">
          <canvas class="gl" aria-label="Vista 3D"></canvas>
          <div class="floatbar">
            <button class="fb" data-act="auto" title="Girar solo">${icon("rotar", 18)}</button>
            <button class="fb" data-act="reset" title="Vista inicial">${icon("inicio", 18)}</button>
            <span class="sep"></span>
            <button class="fb" data-act="photo" title="Foto">${icon("camara", 18)}</button>
            <button class="fb primary" data-act="video" title="Video 360°">${icon("play", 18)}</button>
          </div>
          <p class="stage-hint">Arrastrá para girar · rueda para acercar</p>
        </div>
      </section>
      <aside class="tool-side"></aside>
    </div>`;

  const canvas = root.querySelector<HTMLCanvasElement>("canvas.gl")!;
  try {
    viewer = new Viewer(canvas);
  } catch (e) {
    root.querySelector(".stage3d")!.innerHTML = `<div class="empty">${esc(errorText(e))}</div>`;
  }
  const ro = new ResizeObserver(() => viewer?.resize());
  ro.observe(canvas);
  if (viewer) {
    viewer.bg = [...BACKGROUNDS[0].rgba] as [number, number, number, number];
    setProduct("camiseta");
  }
  renderSide();

  // Cámara orbital.
  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (!viewer) return;
    drag = { x: e.clientX, y: e.clientY, yaw: viewer.yaw, pitch: viewer.pitch };
    canvas.setPointerCapture(e.pointerId);
    viewer.auto = false;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || !viewer) return;
    viewer.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
    viewer.pitch = Math.max(-0.9, Math.min(0.9, drag.pitch + (e.clientY - drag.y) * 0.006));
    viewer.invalidate();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!viewer) return;
      e.preventDefault();
      viewer.dist = Math.max(2.4, Math.min(9, viewer.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      viewer.invalidate();
    },
    { passive: false },
  );

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-chip]");
    if (chip) {
      const k = chip.dataset.chip!;
      const v = chip.dataset.value!;
      if (k === "product") {
        setProduct(v as ProductKind);
        if (v === "taza") s.color = "#ffffff";
      }
      else if (k === "side") s.side = v as "frente" | "espalda";
      else if (k === "bg" && viewer) {
        s.bg = v;
        viewer.bg = [...BACKGROUNDS.find((b) => b.id === v)!.rgba] as [number, number, number, number];
        root.querySelector(".stage3d")!.classList.toggle("checker", v === "transparente");
        viewer.invalidate();
      }
      persist();
      return renderSide();
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act || !viewer) return;
    if (act === "auto") viewer.auto = !viewer.auto;
    else if (act === "reset") {
      Object.assign(viewer, { yaw: 0.35, pitch: 0.12, auto: false, dist: s.product === "camiseta" ? 5.1 : viewer.dist });
      viewer.invalidate();
    } else if (act === "photo") void photo();
    else if (act === "video") void video();
    else if (act === "remove") {
      s.prints[slot()]?.img.close();
      s.prints[slot()] = undefined;
      compose();
      persist();
      renderSide();
    }
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k;
    const pl = s.place[slot()];
    if (k === "scale" || k === "x" || k === "y") {
      pl[k] = Number(el.value) / 100;
      const b = el.closest("label")?.querySelector("b");
      if (b && k === "scale") b.textContent = `${el.value}%`;
      compose();
      persist();
    } else if (k === "color" && viewer) {
      s.color = el.value;
      viewer.base = hexToRgb(el.value);
      viewer.invalidate();
      persist();
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === "full") {
      s.place[slot()].full = el.checked;
      compose();
      persist();
      renderSide();
    }
  });

  const stop = onPaste(root, (f) => setPrint(f, f.name.replace(/\.[^.]+$/, "")));
  ctx.onReceive((h) => void setPrint(h.blob, h.name));

  async function restore() {
    const saved = await session.load();
    if (!saved) return;
    Object.assign(s, { color: saved.color, bg: saved.bg, side: saved.side, place: { ...s.place, ...saved.place } });
    for (const [k, p] of Object.entries(saved.prints)) {
      if (p && !s.prints[k]) s.prints[k] = { img: await createImageBitmap(p.blob), name: p.name, blob: p.blob };
    }
    if (viewer) {
      viewer.bg = [...BACKGROUNDS.find((b) => b.id === s.bg)!.rgba] as [number, number, number, number];
      root.querySelector(".stage3d")!.classList.toggle("checker", s.bg === "transparente");
      setProduct(saved.product);
      s.color = saved.color;
      viewer.base = hexToRgb(s.color);
    }
    compose();
    renderSide();
  }

  const h = ctx.takeHandoff();
  void restore().then(() => h && setPrint(h.blob, h.name));

  return () => {
    stop();
    session.flush();
    ro.disconnect();
    viewer?.dispose();
    Object.values(s.prints).forEach((p) => p?.img.close());
  };
};

