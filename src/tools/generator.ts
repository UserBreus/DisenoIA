// Generador de imágenes: pedido + estilo + proporción + cantidad. Los resultados van a la biblioteca.
import type { Mount } from "../app/tools";
import { busy, chips, errorText, esc, layout, resultCard, section } from "../app/ui";
import { makeImage } from "../core/imaging";
import { getAssets, type Asset } from "../core/store";
import { toolSession } from "../core/session";
import { RATIOS, STYLES, generatorPrompt, type StyleId } from "../core/tool-prompts";
import { toast } from "../ui/dom";

export const mount: Mount = (root, ctx) => {
  const s = {
    idea: "",
    style: "vector" as StyleId,
    ratio: "1:1",
    count: "2",
    print: true,
    transparent: false,
    pending: 0,
    since: 0,
    results: [] as Asset[],
  };
  let alive = true;
  type Saved = Omit<typeof s, "pending" | "since" | "results"> & { results: string[] };
  const session = toolSession<Saved>("generador");
  const persist = () => {
    const { pending: _p, since: _t, results, ...rest } = s;
    session.save({ ...rest, results: results.map((r) => r.id) });
  };

  async function generate() {
    if (!s.idea.trim()) return toast("Escribí qué querés generar.");
    const n = Number(s.count);
    const ratio = RATIOS.find((r) => r.id === s.ratio)!.value;
    const prompt = generatorPrompt(s.idea, s.style, s.print);
    if (!s.pending) s.since = Date.now();
    s.pending += n;
    render();
    await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        try {
          const blob = await makeImage(ctx.settings(), {
            tool: "generador",
            operation: "generar",
            prompt: n > 1 ? `${prompt}\nVariation ${i + 1} of ${n}: explore a distinct composition.` : prompt,
            ratio,
            transparent: s.transparent,
          });
          const name = `${s.idea.trim().slice(0, 40)}${n > 1 ? ` (${i + 1})` : ""}`;
          s.results.unshift(await ctx.keep({ tool: "generador", name, blob, meta: { prompt: s.idea, style: s.style } }));
          persist();
        } catch (e) {
          toast(errorText(e));
        } finally {
          s.pending--;
          if (alive) render();
        }
      }),
    );
  }

  function render() {
    const style = STYLES.find((x) => x.id === s.style)!;
    const main = `
      <div class="prompt-card">
        <textarea class="prompt" data-k="idea" rows="3" placeholder="Describí la imagen. Ej.: mascota de lobo para el uniforme del equipo, estilo emblema">${esc(s.idea)}</textarea>
        <div class="prompt-bar">
          ${chips("style", STYLES, s.style)}
          <button class="btn primary" data-act="go" ${s.pending ? "disabled" : ""}>Generar ${s.count === "1" ? "" : `×${s.count}`}</button>
        </div>
      </div>
      ${s.pending ? busy(`Generando ${s.pending} imagen${s.pending > 1 ? "es" : ""} en estilo ${style.label.toLowerCase()}…`, s.since) : ""}
      ${s.results.length ? `<div class="results-grid">${s.results.map((a) => resultCard(a, { caption: String(a.meta?.style ?? "") })).join("")}</div>` : ""}`;
    const side = section(
      "Formato",
      `<span class="label">Proporción</span>${chips("ratio", RATIOS.map((r) => ({ id: r.id, label: r.id })), s.ratio)}
       <span class="label">Cantidad</span>${chips("count", ["1", "2", "3", "4"].map((x) => ({ id: x, label: x })), s.count)}
       <label class="toggle"><input type="checkbox" data-k="print" ${s.print ? "checked" : ""}/> <span>Pensado para estampar</span></label>
       <label class="toggle"><input type="checkbox" data-k="transparent" ${s.transparent ? "checked" : ""}/> <span>Fondo transparente</span></label>`,
    );
    root.innerHTML = layout(main, side);
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-chip]");
    if (chip) {
      (s as Record<string, unknown>)[chip.dataset.chip!] = chip.dataset.value!;
      persist();
      return render();
    }
    if (t.closest("[data-act=go]")) void generate();
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLTextAreaElement;
    if (el.dataset.k === "idea") {
      s.idea = el.value;
      persist();
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === "print") s.print = el.checked;
    if (el.dataset.k === "transparent") s.transparent = el.checked;
    persist();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void generate();
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
