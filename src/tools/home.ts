// Inicio: flujo principal (idea → extracción → vector → mockup), el resto de herramientas y lo reciente.
import { icon } from "../app/icons";
import type { Mount, ToolDef } from "../app/tools";
import { TOOLS } from "../app/tools";
import { bindDrops, dropzone, esc, onPaste } from "../app/ui";
import { wordmark } from "../app/wordmark";
import { listAssets } from "../core/store";
import { blobUrl } from "../ui/dom";

const FLOW = ["creador", "extractor", "vectorizador", "mockup"];

const node = (t: ToolDef, step?: number) => `
  <a class="node ink-${t.ink}" href="#/${t.id}">
    <span class="node-top"><span class="node-icon">${icon(t.icon, 20)}</span>${step ? `<span class="node-step">0${step}</span>` : ""}</span>
    <b>${esc(t.label)}</b>
    <small>${esc(t.desc)}</small>
    <span class="node-go">${icon("flecha", 16)}</span>
  </a>`;

export const mount: Mount = (root, ctx) => {
  const flow = FLOW.map((id) => TOOLS.find((t) => t.id === id)!);
  const rest = TOOLS.filter((t) => !FLOW.includes(t.id));

  root.innerHTML = `
    <div class="home">
      <header class="home-head">
        ${wordmark(54)}
        <p>Del pedido del cliente al archivo de producción: extraé, vectorizá, generá y mostrá en 3D.</p>
      </header>
      <section class="home-flow">
        <h4>Flujo de producción</h4>
        <div class="flow">${flow.map((t, i) => node(t, i + 1)).join('<span class="link" aria-hidden="true"></span>')}</div>
      </section>
      <div class="home-grid">
        <section>
          <h4>Herramientas</h4>
          <div class="nodes">${rest.map((t) => node(t)).join("")}</div>
        </section>
        <aside class="home-side">
          ${dropzone({ id: "quick", title: "Extraer de una foto", hint: "Soltá o pegá la foto del producto", compact: true })}
          <div id="recent"></div>
        </aside>
      </div>
    </div>`;

  bindDrops(root, (f) => ctx.navigate("extractor", { blob: f, name: f.name }));
  const stop = onPaste(root, (f) => ctx.navigate("extractor", { blob: f, name: f.name }));

  // Lo reciente se actualiza cada vez que se vuelve al inicio.
  const refresh = () => void listAssets().then((assets) => {
    const box = root.querySelector("#recent");
    if (!box || !assets.length) return;
    box.innerHTML = `<h4>Reciente</h4><div class="recent">${assets
      .slice(0, 8)
      .map((a) => `<a class="recent-item checker" href="#/biblioteca" title="${esc(a.name)}"><img src="${blobUrl(a.blob)}" alt="" loading="lazy"/></a>`)
      .join("")}</div>`;
  });
  ctx.onShow(refresh);

  return stop;
};
