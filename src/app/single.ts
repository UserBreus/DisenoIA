// Plantilla para herramientas de "una imagen de entrada → resultados" (Upscaler, Fondo mágico, Recreador…).
import { blobUrl, toast } from "../ui/dom";
import { getAssets, type Asset } from "../core/store";
import { toolSession } from "../core/session";
import type { Mount, ToolContext } from "./tools";
import { bindDrops, busy, dropzone, errorText, layout, onPaste, picked, resultCard, section, type Picked } from "./ui";

export interface SingleState {
  input: Picked | null;
  results: Asset[];
  selected: number;
  working: string;
  /** Inicio del trabajo en curso (para el contador). */
  since: number;
  opts: Record<string, string>;
}

export interface SingleConfig {
  id: string;
  dropTitle: string;
  dropHint: string;
  /** Valores iniciales de las opciones (todas como texto). */
  defaults: Record<string, string>;
  /** HTML de las opciones. Los controles usan data-opt="clave" (inputs) o data-chip="clave" (chips). */
  options: (s: SingleState, ctx: ToolContext) => string;
  /** Texto del botón principal. */
  action: (s: SingleState) => string;
  /** Mensaje mientras trabaja. */
  workingText: (s: SingleState) => string;
  run: (input: Picked, s: SingleState, ctx: ToolContext) => Promise<{ blob: Blob; name: string; caption?: string; meta?: Record<string, unknown> }>;
  /** Validación previa (devuelve un mensaje para cortar). */
  check?: (s: SingleState) => string | null;
}

export function singleTool(cfg: SingleConfig): Mount {
  return (root, ctx) => {
    const s: SingleState = { input: null, results: [], selected: 0, working: "", since: 0, opts: { ...cfg.defaults } };
    let alive = true;
    // Caché local: entrada, opciones y resultados sobreviven al cambiar de herramienta o recargar.
    const session = toolSession<{ input: Blob | null; name: string; opts: Record<string, string>; results: string[]; selected: number }>(cfg.id);
    const persist = () =>
      session.save({ input: s.input?.blob ?? null, name: s.input?.name ?? "", opts: s.opts, results: s.results.map((r) => r.id), selected: s.selected });

    const setInput = (blob: Blob, name: string) => {
      if (s.input) URL.revokeObjectURL(s.input.url);
      s.input = picked(blob, name);
      s.results = [];
      persist();
      render();
    };

    async function run() {
      if (!s.input || s.working) return;
      const problem = cfg.check?.(s);
      if (problem) return toast(problem);
      s.working = cfg.workingText(s);
      s.since = Date.now();
      render();
      try {
        const out = await cfg.run(s.input, s, ctx);
        const asset = await ctx.keep({ tool: cfg.id, name: out.name, blob: out.blob, meta: { ...out.meta, caption: out.caption } });
        s.results.unshift(asset);
        s.selected = 0;
        persist();
      } catch (e) {
        toast(errorText(e));
      } finally {
        s.working = "";
        if (alive) render();
      }
    }

    function render() {
      const sel = s.results[s.selected];
      const main = !s.input
        ? `<div class="tool-intro">${dropzone({ id: "img", title: cfg.dropTitle, hint: cfg.dropHint })}</div>`
        : `<div class="canvas-card">
            <div class="compare big ${sel ? "has-after" : ""}" style="--pos:50%">
              <img class="before" src="${s.input.url}" alt="Original" />
              ${sel ? `<img class="after" src="${blobUrl(sel.blob)}" alt="Resultado" /><input type="range" class="slider" min="0" max="100" value="50" aria-label="Comparar" /><span class="tag l">Original</span><span class="tag r">Resultado</span>` : ""}
            </div>
            ${s.working ? busy(s.working, s.since) : ""}
          </div>`;
      const side = s.input
        ? section("Opciones", `${cfg.options(s, ctx)}
            <button class="btn primary block" data-act="run" ${s.working ? "disabled" : ""}>${cfg.action(s)}</button>
            <button class="btn ghost block" data-act="clear">Otra imagen</button>`) +
          (s.results.length
            ? section(
                `Resultados (${s.results.length})`,
                `${s.results.length > 1 ? `<div class="thumbs">${s.results.map((r, i) => `<button class="thumb ${i === s.selected ? "on" : ""}" data-pick="${i}"><img src="${blobUrl(r.blob)}" alt=""/></button>`).join("")}</div>` : ""}
                 ${resultCard(sel, { exclude: cfg.id, caption: String(sel.meta?.caption ?? "") || undefined })}`,
              )
            : "")
        : undefined;
      root.innerHTML = layout(main, side);
      bindDrops(root, (f) => setInput(f, f.name));
    }

    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest<HTMLElement>("[data-chip]");
      if (chip) {
        s.opts[chip.dataset.chip!] = chip.dataset.value!;
        persist();
        return render();
      }
      const pick = t.closest<HTMLElement>("[data-pick]");
      if (pick) {
        s.selected = Number(pick.dataset.pick);
        persist();
        return render();
      }
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "run") void run();
      else if (act === "clear") {
        s.input = null;
        s.results = [];
        persist();
        render();
      }
    });
    root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.classList.contains("slider")) (el.parentElement as HTMLElement).style.setProperty("--pos", `${el.value}%`);
      else if (el.dataset.opt) {
        s.opts[el.dataset.opt] = el.type === "checkbox" ? String(el.checked) : el.value;
        persist();
      }
    });
    root.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.opt && el.type === "checkbox") {
        s.opts[el.dataset.opt] = String(el.checked);
        persist();
        render();
      }
    });

    const stop = onPaste(root, (f) => setInput(f, f.name));
    ctx.onReceive((h) => setInput(h.blob, h.name));

    async function restore() {
      const saved = await session.load();
      if (!saved || s.input) return render();
      s.opts = { ...cfg.defaults, ...saved.opts };
      if (saved.input) s.input = picked(saved.input, saved.name);
      s.results = await getAssets(saved.results);
      s.selected = Math.min(saved.selected, Math.max(0, s.results.length - 1));
      render();
    }

    const h = ctx.takeHandoff();
    if (h) setInput(h.blob, h.name);
    else void restore();
    return () => {
      alive = false;
      session.flush();
      stop();
    };
  };
}
