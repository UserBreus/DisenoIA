// Biblioteca / estudio: todo lo generado por las herramientas, las extracciones y el registro de operaciones.
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { TOOLS } from "../app/tools";
import { esc, layout, resultCard, section } from "../app/ui";
import { deleteAsset, deleteExtraction, listAssets, listExtractions, listOps, type Asset } from "../core/store";
import type { Extraction, OpLog } from "../core/types";
import { FAILURE_LABELS } from "../providers/http";
import { blobUrl, fmtDate } from "../ui/dom";

type Tab = "archivos" | "extracciones" | "registro";

export const mount: Mount = (root, ctx) => {
  const s = {
    tab: "archivos" as Tab,
    filter: "todo",
    q: "",
    assets: [] as Asset[],
    extractions: [] as Extraction[],
    ops: [] as OpLog[],
    selected: null as Asset | null,
  };

  async function load() {
    [s.assets, s.extractions, s.ops] = await Promise.all([listAssets(), listExtractions(), listOps()]);
    render();
  }

  const toolLabel = (id: string) => TOOLS.find((t) => t.id === id)?.label ?? id;
  const toolInk = (id: string) => TOOLS.find((t) => t.id === id)?.ink ?? "c";

  function filtered() {
    const q = s.q.trim().toLowerCase();
    return s.assets.filter((a) => (s.filter === "todo" || a.tool === s.filter) && (!q || a.name.toLowerCase().includes(q)));
  }

  function tabs() {
    const t = (id: Tab, label: string, n: number) => `<button class="tab ${s.tab === id ? "on" : ""}" data-tab="${id}">${label}<small>${n}</small></button>`;
    return `<div class="tabs">${t("archivos", "Archivos", s.assets.length)}${t("extracciones", "Extracciones", s.extractions.length)}${t("registro", "Registro", s.ops.length)}</div>`;
  }

  function filesView() {
    const tools = [...new Set(s.assets.map((a) => a.tool))];
    const list = filtered();
    return `
      <div class="lib-bar">
        <input class="input" data-k="q" value="${esc(s.q)}" placeholder="Buscar por nombre" />
        <div class="chips">${[{ id: "todo", label: "Todo" }, ...tools.map((t) => ({ id: t, label: toolLabel(t) }))]
          .map((o) => `<button class="chip ${o.id === s.filter ? "on" : ""}" data-filter="${o.id}">${esc(o.label)}</button>`)
          .join("")}</div>
      </div>
      ${
        list.length
          ? `<div class="lib-grid">${list
              .map(
                (a) => `<button class="lib-item ${s.selected?.id === a.id ? "on" : ""}" data-asset-pick="${a.id}">
                  <span class="lib-thumb checker"><img src="${blobUrl(a.blob)}" alt="" loading="lazy"/></span>
                  <span class="lib-name">${esc(a.name)}</span>
                  <span class="lib-meta"><i class="dot ink-${toolInk(a.tool)}"></i>${esc(toolLabel(a.tool))} · ${fmtDate(a.createdAt)}${a.svg ? " · vector" : ""}</span>
                </button>`,
              )
              .join("")}</div>`
          : `<div class="empty">${s.assets.length ? "Nada coincide con la búsqueda." : "Todavía no generaste archivos. Todo lo que crees en las herramientas aparece acá."}</div>`
      }`;
  }

  function extractionsView() {
    return s.extractions.length
      ? `<div class="lib-grid">${s.extractions
          .map((x) => {
            const done = x.items.filter((i) => i.versions.length).length;
            return `<article class="lib-item static">
              <span class="lib-thumb"><img src="${blobUrl(x.source)}" alt="" loading="lazy"/></span>
              <span class="lib-name">${esc(x.name)}</span>
              <span class="lib-meta">${fmtDate(x.updatedAt)} · ${x.items.length} artes · ${done} recreados</span>
              <span class="row"><a class="btn primary sm" href="#/extractor?id=${x.id}">Abrir</a><button class="btn ghost sm" data-del-ext="${x.id}">${icon("borrar", 16)}</button></span>
            </article>`;
          })
          .join("")}</div>`
      : `<div class="empty">Sin extracciones guardadas en este navegador.</div>`;
  }

  function opsView() {
    return s.ops.length
      ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Herramienta</th><th>Operación</th><th>Proveedor</th><th>Resultado</th><th>Duración</th></tr></thead><tbody>${s.ops
          .slice(0, 80)
          .map(
            (o) => `<tr class="${o.status}"><td>${fmtDate(o.startedAt)}</td><td>${esc(o.extractionId.startsWith("ext-") ? "Extractor" : toolLabel(o.extractionId))}</td><td>${o.operation}</td>
              <td>${esc(o.provider)} · ${esc(o.model)}</td><td>${o.status === "ok" ? "OK" : esc(FAILURE_LABELS[o.failure ?? "unknown"])}</td><td>${(o.durationMs / 1000).toFixed(1)} s</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : `<div class="empty">Sin operaciones registradas.</div>`;
  }

  function render() {
    const main = `${tabs()}${s.tab === "archivos" ? filesView() : s.tab === "extracciones" ? extractionsView() : opsView()}`;
    const side =
      s.tab === "archivos" && s.selected
        ? section("Archivo", `${resultCard(s.selected, { caption: toolLabel(s.selected.tool) })}<button class="btn ghost block danger" data-del-asset="${s.selected.id}">${icon("borrar", 16)} Borrar de la biblioteca</button>`)
        : undefined;
    root.innerHTML = layout(main, side);
  }

  root.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) {
      s.tab = tab.dataset.tab as Tab;
      return render();
    }
    const f = t.closest<HTMLElement>("[data-filter]");
    if (f) {
      s.filter = f.dataset.filter!;
      return render();
    }
    const pick = t.closest<HTMLElement>("[data-asset-pick]");
    if (pick) {
      s.selected = s.assets.find((a) => a.id === pick.dataset.assetPick) ?? null;
      return render();
    }
    const del = t.closest<HTMLElement>("[data-del-asset]");
    if (del && confirm("¿Borrar este archivo de la biblioteca? No se puede deshacer.")) {
      await deleteAsset(del.dataset.delAsset!);
      s.selected = null;
      return load();
    }
    const delx = t.closest<HTMLElement>("[data-del-ext]");
    if (delx && confirm("¿Borrar esta extracción? No se puede deshacer.")) {
      await deleteExtraction(delx.dataset.delExt!);
      return load();
    }
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k !== "q") return;
    s.q = el.value;
    const pos = el.selectionStart;
    render();
    const again = root.querySelector<HTMLInputElement>("[data-k=q]");
    again?.focus();
    if (pos != null) again?.setSelectionRange(pos, pos);
  });

  root.innerHTML = `<div class="busy center"><span class="spin"></span></div>`;
  // Se recarga al volver: muestra lo que las otras herramientas generaron mientras tanto.
  ctx.onShow(() => void load());
};
