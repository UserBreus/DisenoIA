// Creador: de la idea del cliente a 2 modelos de producto, listos para extraer sus materiales.
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { busy, chips, errorText, esc, layout, resultCard, section } from "../app/ui";
import { makeImage } from "../core/imaging";
import { getAssets, type Asset } from "../core/store";
import { toolSession } from "../core/session";
import { PRODUCTS_FOR_CREATOR, creatorPrompt, type CreatorProduct } from "../core/tool-prompts";
import { toast } from "../ui/dom";

export const mount: Mount = (root, ctx) => {
  const s = { idea: "", product: "camiseta-deportiva" as CreatorProduct, pending: 0, since: 0, results: [] as Asset[] };
  let alive = true;
  const session = toolSession<{ idea: string; product: CreatorProduct; results: string[] }>("creador");
  const persist = () => session.save({ idea: s.idea, product: s.product, results: s.results.map((r) => r.id) });

  async function create() {
    if (!s.idea.trim()) return toast("Pegá la idea del cliente (o la tuya).");
    const product = PRODUCTS_FOR_CREATOR.find((p) => p.id === s.product)!;
    s.pending = 2;
    s.since = Date.now();
    s.results = [];
    render();
    await Promise.all(
      [0, 1].map(async (variant) => {
        try {
          const blob = await makeImage(ctx.settings(), { tool: "creador", operation: "generar", prompt: creatorPrompt(s.idea, s.product, variant), ratio: product.ratio });
          const asset = await ctx.keep({ tool: "creador", name: `${product.label} · modelo ${variant === 0 ? "A" : "B"}`, blob, meta: { idea: s.idea, product: s.product } });
          s.results.push(asset);
          s.results.sort((a, b) => a.name.localeCompare(b.name));
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
    const main = `
      <div class="prompt-card">
        <textarea class="prompt" data-k="idea" rows="4" placeholder="Ej.: camiseta del equipo “Los Lobos”, negra y azul bien agresiva, número 10 en la espalda, sponsor “Panadería Sol” en el pecho">${esc(s.idea)}</textarea>
        <div class="prompt-bar">
          ${chips("product", PRODUCTS_FOR_CREATOR, s.product)}
          <button class="btn primary" data-act="go" ${s.pending ? "disabled" : ""}>Crear 2 modelos</button>
        </div>
      </div>
      ${s.pending ? busy(`Creando ${s.pending === 2 ? "los dos modelos" : "el segundo modelo"}…`, s.since) : ""}
      ${
        s.results.length
          ? `<div class="results-grid two">${s.results
              .map((a) =>
                resultCard(a, {
                  extra: `<button class="btn primary sm" data-extract="${a.id}">${icon("extractor", 16)} Extraer materiales</button>`,
                }),
              )
              .join("")}</div>`
          : ""
      }`;
    const side = section(
      "Cómo funciona",
      `<ol class="steps">
        <li><b>Describí la idea</b> como te la pidió el cliente: colores, textos, números, estilo.</li>
        <li><b>Elegí el producto</b> y generá dos interpretaciones distintas.</li>
        <li><b>Extraé los materiales</b> del modelo elegido: cada logo, texto y fondo sale por separado.</li>
      </ol>`,
    );
    root.innerHTML = layout(main, side);
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-chip]");
    if (chip) {
      s.product = chip.dataset.value as CreatorProduct;
      persist();
      return render();
    }
    const ex = t.closest<HTMLElement>("[data-extract]");
    if (ex) {
      const a = s.results.find((r) => r.id === ex.dataset.extract);
      if (a) ctx.navigate("extractor", { blob: a.blob, name: a.name });
      return;
    }
    if (t.closest("[data-act=go]")) void create();
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLTextAreaElement;
    if (el.dataset.k === "idea") {
      s.idea = el.value;
      persist();
    }
  });

  render();
  void session.load().then(async (saved) => {
    if (!saved || s.pending) return;
    Object.assign(s, { idea: saved.idea, product: saved.product, results: await getAssets(saved.results) });
    render();
  });
  return () => {
    alive = false;
    session.flush();
  };
};
