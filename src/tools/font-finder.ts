// Buscador de fuentes: recortás el texto de una imagen y la IA identifica la tipografía (+ alternativas gratis).
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { bindDrops, busy, dropzone, errorText, esc, layout, onPaste, picked, section, type Picked } from "../app/ui";
import { blobToCanvas, canvasToBlob, makeCanvas } from "../core/image";
import { askVision } from "../core/imaging";
import { parseModelJson } from "../core/schema";
import { FONT_FINDER_SYSTEM, fontFinderPrompt } from "../core/tool-prompts";
import { toast } from "../ui/dom";
import { toolSession } from "../core/session";

interface FontGuess {
  name: string;
  category: string;
  confidence: number;
  google: boolean;
  why: string;
}

const loaded = new Set<string>();

/** Carga la familia desde Google Fonts para la vista previa (sólo si existe allí). */
function loadGoogleFont(name: string) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}&display=swap`;
  document.head.appendChild(link);
}

export const mount: Mount = (root, ctx) => {
  const s = {
    input: null as Picked | null,
    sel: null as null | { x: number; y: number; w: number; h: number },
    working: false,
    since: 0,
    text: "",
    fonts: [] as FontGuess[],
    preview: "",
  };
  let drag: { x: number; y: number } | null = null;
  const session = toolSession<{ input: Blob | null; name: string; sel: typeof s.sel; text: string; fonts: FontGuess[]; preview: string }>("buscador");
  const persist = () =>
    session.save({ input: s.input?.blob ?? null, name: s.input?.name ?? "", sel: s.sel, text: s.text, fonts: s.fonts, preview: s.preview });

  const setInput = (blob: Blob, name: string) => {
    if (s.input) URL.revokeObjectURL(s.input.url);
    s.input = picked(blob, name);
    s.sel = null;
    s.fonts = [];
    persist();
    render();
  };

  async function crop(): Promise<Blob> {
    if (!s.input) throw new Error("Sin imagen");
    if (!s.sel || s.sel.w < 0.02 || s.sel.h < 0.02) return s.input.blob;
    const src = await blobToCanvas(s.input.blob);
    const sx = s.sel.x * src.width, sy = s.sel.y * src.height, sw = s.sel.w * src.width, sh = s.sel.h * src.height;
    const [c, cx] = makeCanvas(sw, sh);
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvasToBlob(c);
  }

  async function identify() {
    if (!s.input || s.working) return;
    s.working = true;
    s.since = Date.now();
    render();
    try {
      const raw = await askVision(ctx.settings(), {
        tool: "buscador",
        operation: "buscar-fuente",
        image: await crop(),
        system: FONT_FINDER_SYSTEM,
        prompt: fontFinderPrompt(),
        task: "fonts",
      });
      const j = parseModelJson(raw) as { text?: string; fonts?: Partial<FontGuess>[] };
      s.text = String(j.text ?? "");
      s.preview ||= s.text;
      s.fonts = (j.fonts ?? [])
        .filter((f) => f.name)
        .map((f) => ({
          name: String(f.name).trim(),
          category: String(f.category ?? ""),
          confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0)),
          google: f.google === true,
          why: String(f.why ?? ""),
        }))
        .slice(0, 6);
      s.fonts.filter((f) => f.google).forEach((f) => loadGoogleFont(f.name));
      if (!s.fonts.length) toast("No pude identificar la tipografía. Probá recortando solo el texto.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      s.working = false;
      persist();
      render();
    }
  }

  function render() {
    const sel = s.sel;
    const main = !s.input
      ? `<div class="tool-intro">${dropzone({ id: "img", title: "Soltá una captura del texto", hint: "Mejor si contiene solo el texto · también Ctrl+V" })}</div>`
      : `<div class="canvas-card">
          <div class="cropper" data-crop>
            <img src="${s.input.url}" alt="" draggable="false" />
            ${sel ? `<div class="crop-box" style="left:${sel.x * 100}%;top:${sel.y * 100}%;width:${sel.w * 100}%;height:${sel.h * 100}%"></div>` : ""}
          </div>
          <p class="hint center">Arrastrá sobre la imagen para elegir solo el texto. Sin recorte se analiza la imagen completa.</p>
          ${s.working ? busy("Identificando la tipografía…", s.since) : ""}
        </div>`;
    const side = s.input
      ? section(
          "Identificar",
          `<button class="btn primary block" data-act="go" ${s.working ? "disabled" : ""}>${icon("buscador", 16)} Identificar fuente</button>
           ${sel ? `<button class="btn ghost block" data-act="nosel">Quitar recorte</button>` : ""}
           <button class="btn ghost block" data-act="clear">Otra imagen</button>`,
        ) +
        (s.fonts.length
          ? section(
              "Coincidencias",
              `<input class="input" data-k="preview" value="${esc(s.preview)}" placeholder="Texto de prueba" />
               <div class="fonts">${s.fonts
                 .map(
                   (f, i) => `<article class="font ${i === 0 ? "best" : ""}">
                    <div class="font-sample" style="${f.google ? `font-family:'${esc(f.name)}',${f.category === "serif" ? "serif" : "sans-serif"}` : ""}">${esc(s.preview || s.text || f.name)}</div>
                    <div class="font-meta">
                      <b>${esc(f.name)}</b>
                      <span class="meter"><i style="width:${Math.round(f.confidence * 100)}%"></i></span>
                      <small>${Math.round(f.confidence * 100)}% · ${esc(f.category)} · ${f.google ? "Google Fonts (gratis)" : "comercial"}</small>
                      ${f.why ? `<small class="why">${esc(f.why)}</small>` : ""}
                      ${f.google ? `<a class="pill-btn" target="_blank" rel="noopener" href="https://fonts.google.com/specimen/${encodeURIComponent(f.name).replace(/%20/g, "+")}">Ver en Google Fonts</a>` : ""}
                    </div>
                  </article>`,
                 )
                 .join("")}</div>`,
            )
          : "")
      : undefined;
    root.innerHTML = layout(main, side);
    bindDrops(root, (f) => setInput(f, f.name));
  }

  // Selección del recorte con el puntero.
  const rel = (e: PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  root.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-crop]");
    if (!el) return;
    drag = rel(e, el);
    el.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-crop]");
    if (!drag || !el) return;
    const p = rel(e, el);
    s.sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
    let box = el.querySelector<HTMLElement>(".crop-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "crop-box";
      el.appendChild(box);
    }
    Object.assign(box.style, { left: `${s.sel.x * 100}%`, top: `${s.sel.y * 100}%`, width: `${s.sel.w * 100}%`, height: `${s.sel.h * 100}%` });
  });
  root.addEventListener("pointerup", () => {
    if (drag) {
      drag = null;
      if (s.sel && (s.sel.w < 0.02 || s.sel.h < 0.02)) s.sel = null;
      persist();
      render();
    }
  });
  root.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "go") void identify();
    else if (act === "nosel") {
      s.sel = null;
      persist();
      render();
    } else if (act === "clear") {
      s.input = null;
      s.fonts = [];
      persist();
      render();
    }
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k !== "preview") return;
    s.preview = el.value;
    persist();
    root.querySelectorAll<HTMLElement>(".font-sample").forEach((n) => (n.textContent = s.preview || s.text));
  });

  const stop = onPaste(root, (f) => setInput(f, f.name));
  ctx.onReceive((h) => setInput(h.blob, h.name));

  async function restore() {
    const saved = await session.load();
    if (saved && !s.input) {
      Object.assign(s, { sel: saved.sel, text: saved.text, fonts: saved.fonts, preview: saved.preview });
      if (saved.input) s.input = picked(saved.input, saved.name);
      s.fonts.filter((f) => f.google).forEach((f) => loadGoogleFont(f.name));
    }
    render();
  }

  const h = ctx.takeHandoff();
  if (h) setInput(h.blob, h.name);
  else void restore();
  return () => {
    stop();
    session.flush();
  };
};
