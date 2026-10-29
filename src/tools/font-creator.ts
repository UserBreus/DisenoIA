// Creador de fuentes: letterings estilizados con IA, con fondo transparente y listos para vectorizar.
import type { Mount } from "../app/tools";
import { busy, errorText, esc, layout, resultCard, section } from "../app/ui";
import { makeImage } from "../core/imaging";
import { getAssets, type Asset } from "../core/store";
import { toolSession } from "../core/session";
import { fontCreatorPrompt } from "../core/tool-prompts";
import { toast } from "../ui/dom";

const STYLE_IDEAS = [
  "graffiti con goteo y contorno grueso",
  "cromado 3D brillante",
  "varsity deportivo con doble contorno",
  "caligrafía brush expresiva",
  "neón con brillo",
  "retro de los 70 con sombra",
  "gótico tatuaje",
];

export const mount: Mount = (root, ctx) => {
  const s = { text: "", style: STYLE_IDEAS[0], colors: "", ratio: "3:1", pending: 0, since: 0, results: [] as Asset[] };
  let alive = true;
  const session = toolSession<{ text: string; style: string; colors: string; ratio: string; results: string[] }>("fuentes");
  const persist = () => session.save({ text: s.text, style: s.style, colors: s.colors, ratio: s.ratio, results: s.results.map((r) => r.id) });

  async function create() {
    if (!s.text.trim()) return toast("Escribí el texto del lettering.");
    const ratio = s.ratio === "3:1" ? 3 : s.ratio === "1:1" ? 1 : 2;
    if (!s.pending) s.since = Date.now();
    s.pending++;
    render();
    try {
      const blob = await makeImage(ctx.settings(), {
        tool: "fuentes",
        operation: "fuente",
        prompt: fontCreatorPrompt(s.text, s.style, s.colors),
        ratio,
        transparent: true,
      });
      s.results.unshift(await ctx.keep({ tool: "fuentes", name: s.text.trim().slice(0, 40), blob, meta: { style: s.style } }));
      persist();
    } catch (e) {
      toast(errorText(e));
    } finally {
      s.pending--;
      if (alive) render();
    }
  }

  function render() {
    const main = `
      <div class="prompt-card">
        <input class="prompt big-text" data-k="text" value="${esc(s.text)}" placeholder="Tu texto: Los Lobos 2026" maxlength="80" />
        <div class="prompt-bar">
          <input class="input" data-k="style" value="${esc(s.style)}" placeholder="Estilo del lettering" />
          <input class="input" data-k="colors" value="${esc(s.colors)}" placeholder="Colores (opcional): negro y dorado" />
          <button class="btn primary" data-act="go" ${s.pending ? "disabled" : ""}>Crear lettering</button>
        </div>
        <div class="suggest">${STYLE_IDEAS.map((x) => `<button type="button" class="chip ${x === s.style ? "on" : ""}" data-style="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      </div>
      ${s.pending ? busy("Diseñando el lettering…", s.since) : ""}
      ${s.results.length ? `<div class="results-grid">${s.results.map((a) => resultCard(a, { caption: String(a.meta?.style ?? "") })).join("")}</div>` : ""}`;
    const side = section(
      "Formato",
      `<span class="label">Proporción</span>
       <div class="chips">${["3:1", "2:1", "1:1"].map((r) => `<button class="chip ${r === s.ratio ? "on" : ""}" data-ratio="${r}">${r}</button>`).join("")}</div>
       <p class="hint">Sale con fondo transparente. Mandalo al Vectorizador para tenerlo en SVG, EPS o PDF.</p>`,
    );
    root.innerHTML = layout(main, side);
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>("[data-style]");
    if (st) {
      s.style = st.dataset.style!;
      persist();
      return render();
    }
    const r = t.closest<HTMLElement>("[data-ratio]");
    if (r) {
      s.ratio = r.dataset.ratio!;
      persist();
      return render();
    }
    if (t.closest("[data-act=go]")) void create();
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === "text") s.text = el.value;
    if (el.dataset.k === "style") s.style = el.value;
    if (el.dataset.k === "colors") s.colors = el.value;
    persist();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).dataset.k) void create();
  });

  render();
  void session.load().then(async (saved) => {
    if (!saved) return;
    const { results, ...rest } = saved;
    Object.assign(s, rest, { results: [...s.results, ...(await getAssets(results))] });
    render();
  });
  return () => {
    alive = false;
    session.flush();
  };
};
