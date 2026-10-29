// Extractor: foto del producto → análisis → cada arte recreado por separado → exportación.
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { SEND_TARGETS } from "../app/tools";
import { dropzone, bindDrops, elapsed, errorText, onPaste } from "../app/ui";
import { getProduct } from "../core/catalog";
import { ImageError, validatePhoto } from "../core/image";
import { CLIENT } from "../core/limits";
import { analyzePhoto, buildItems, cutout, makeGroup, previewCrop, recreate, upscale, vectorize } from "../core/pipeline";
import { PROMPT_VERSION } from "../core/prompts";
import { Queue, uid } from "../core/queue";
import { getExtraction, saveExtraction } from "../core/store";
import { toolSession } from "../core/session";
import { ProviderError, type ArtItem, type Extraction, type GlobalState, type GroupMode } from "../core/types";
import { baseName, download, exportFile, exportZip, type Format } from "../export";
import { KIND_LABEL, STATE_LABEL, blobUrl, esc, toast } from "../ui/dom";

const KIND_INK: Record<string, string> = {
  fondo: "var(--y)",
  logo: "var(--c)",
  texto: "var(--m)",
  parche: "var(--c)",
  etiqueta: "var(--m)",
  figura: "var(--c)",
  grupo: "var(--k)",
};

export const mount: Mount = (root, ctx) => {
  const state = {
    global: "idle" as GlobalState,
    ex: null as Extraction | null,
    bitmap: null as ImageBitmap | null,
    busy: new Set<string>(),
    feedback: {} as Record<string, string>,
    includeTiff: false,
    /** Inicio del análisis y de cada generación (para los contadores). */
    since: 0,
    itemSince: {} as Record<string, number>,
  };
  const queue = new Queue(CLIENT.concurrency);
  const controllers = new Map<string, AbortController>();
  const beforeUrls = new Map<string, string>();
  let alive = true;

  // ---------- persistencia ----------
  // La extracción se guarda completa; la sesión sólo recuerda cuál estaba abierta para retomarla.
  const session = toolSession<{ lastId: string | null }>("extractor");
  let saveTimer = 0;
  const persist = () => {
    clearTimeout(saveTimer);
    session.save({ lastId: state.ex?.id ?? null });
    saveTimer = window.setTimeout(() => {
      if (!state.ex) return;
      state.ex.updatedAt = Date.now();
      void saveExtraction(state.ex);
    }, 300);
  };

  // ---------- flujo ----------
  async function loadFile(file: Blob, name: string) {
    try {
      const bitmap = await validatePhoto(file);
      cancelAll();
      state.bitmap?.close();
      state.bitmap = bitmap;
      beforeUrls.clear();
      state.feedback = {};
      state.ex = {
        id: uid("ext-"),
        name: name.replace(/\.[^.]+$/, "") || "Extracción",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: file,
        width: bitmap.width,
        height: bitmap.height,
        analysis: null,
        items: [],
        promptVersion: PROMPT_VERSION,
      };
      persist();
      await analyze();
    } catch (e) {
      toast(e instanceof ImageError ? e.message : `No se pudo abrir la imagen: ${(e as Error).message}`);
    }
  }

  async function analyze() {
    const ex = state.ex;
    if (!ex || !state.bitmap) return;
    state.global = "analyzing";
    state.since = Date.now();
    render();
    const ctrl = new AbortController();
    controllers.set("analysis", ctrl);
    try {
      const analysis = await analyzePhoto(ex, state.bitmap, ctx.settings(), uid("int-"), ctrl.signal);
      if (state.ex !== ex) return;
      ex.analysis = analysis;
      ex.items = buildItems(analysis);
      beforeUrls.clear();
      state.global = "confirm";
      if (!ex.items.length) toast("No se detectaron artes imprimibles. Probá con otra foto o con otro proveedor.");
    } catch (e) {
      state.global = "idle";
      toast(errorText(e));
    } finally {
      controllers.delete("analysis");
      persist();
      render();
    }
  }

  const findItem = (id: string) => state.ex?.items.find((i) => i.id === id);

  async function runRecreate(item: ArtItem, feedback: string | null) {
    const ex = state.ex;
    if (!ex || !state.bitmap) return;
    if (item.versions.length >= CLIENT.versionsPerItem) return toast(`Máximo ${CLIENT.versionsPerItem} versiones por elemento.`);
    const intent = `${item.id}:${item.versions.length}`;
    const bitmap = state.bitmap;
    item.state = "en_cola";
    item.error = undefined;
    render();
    const ctrl = new AbortController();
    controllers.set(item.id, ctrl);
    try {
      await queue.run(intent, async () => {
        if (ctrl.signal.aborted) throw new ProviderError("cancelled", "Operación cancelada.");
        item.state = "generando";
        state.itemSince[item.id] = Date.now();
        render();
        const v = await recreate(item, ex, bitmap, ctx.settings(), feedback, intent, ctrl.signal);
        item.versions.push(v);
        item.active = item.versions.length - 1;
        item.state = "listo";
        delete state.feedback[item.id];
      });
    } catch (e) {
      // Si ya había versiones, el elemento sigue utilizable: se muestra el error sin perderlas.
      item.state = item.versions.length ? "listo" : "error";
      item.error = { code: e instanceof ProviderError ? e.code : "unknown", message: errorText(e) };
    } finally {
      controllers.delete(item.id);
    }
    if (state.ex === ex) {
      if (!ex.items.some((i) => i.state === "en_cola" || i.state === "generando") && ex.items.some((i) => i.versions.length)) state.global = "done";
      persist();
      render();
    }
  }

  function recreateSelected() {
    const ex = state.ex;
    if (!ex) return;
    const targets = ex.items.filter((i) => i.selected && !i.versions.length && i.state !== "en_cola" && i.state !== "generando");
    if (!targets.length) return toast("Seleccioná elementos sin recrear.");
    state.global = "recreating";
    targets.forEach((t) => void runRecreate(t, null));
  }

  const itemBusy = (item: ArtItem) => [...state.busy].some((k) => k.startsWith(`${item.id}:`));

  async function runTool(item: ArtItem, tool: "upscale" | "vectorize" | "cutout") {
    const ex = state.ex;
    const v = item.versions[item.active];
    if (!ex || !v || itemBusy(item)) return;
    if (tool === "upscale" && item.enlargements >= CLIENT.enlargements) return toast(`Máximo ${CLIENT.enlargements} ampliaciones por elemento.`);
    const key = `${item.id}:${tool}`;
    state.busy.add(key);
    render();
    const intent = uid("int-");
    try {
      if (tool === "upscale") {
        v.enlarged = await upscale(ex, item, v, ctx.settings(), intent);
        item.enlargements++;
        toast("Ampliación lista.", "ok");
      } else if (tool === "vectorize") {
        v.svg = await vectorize(ex, item, v, ctx.settings(), intent);
        toast("Vector listo: ya podés bajar SVG y EPS.", "ok");
      } else {
        v.png = await cutout(ex, item, v, ctx.settings(), intent);
        v.enlarged = undefined;
        v.svg = undefined;
        toast("Fondo quitado.", "ok");
      }
    } catch (e) {
      toast(errorText(e));
    } finally {
      state.busy.delete(key);
      persist();
      render();
    }
  }

  function cancelAll() {
    controllers.forEach((c) => c.abort());
    controllers.clear();
  }

  async function openExtraction(id: string, silent = false) {
    const ex = await getExtraction(id);
    if (!ex) {
      // La última extracción se borró desde la biblioteca: se olvida sin molestar.
      if (silent) return session.save({ lastId: null });
      return toast("No encontré esa extracción.");
    }
    cancelAll();
    state.bitmap?.close();
    state.bitmap = await createImageBitmap(ex.source);
    for (const i of ex.items) if (i.state === "en_cola" || i.state === "generando") i.state = i.versions.length ? "listo" : "detectado";
    state.ex = ex;
    beforeUrls.clear();
    state.feedback = {};
    state.global = ex.items.some((i) => i.versions.length) ? "done" : ex.analysis ? "confirm" : "idle";
    session.save({ lastId: ex.id });
    render();
  }

  function reset() {
    cancelAll();
    state.ex = null;
    state.bitmap?.close();
    state.bitmap = null;
    state.global = "idle";
    session.save({ lastId: null });
    history.replaceState(null, "", "#/extractor");
    render();
  }

  // ---------- render ----------
  function beforeUrl(item: ArtItem): string {
    let u = beforeUrls.get(item.id);
    if (!u && state.bitmap) {
      u = previewCrop(item, state.bitmap).toDataURL("image/jpeg", 0.82);
      beforeUrls.set(item.id, u);
    }
    return u ?? "";
  }

  function stepper(): string {
    const steps = ["Cargar", "Analizar", "Confirmar", "Recrear", "Exportar"];
    const idx = { idle: state.ex ? 1 : 0, analyzing: 1, confirm: 2, recreating: 3, done: 4 }[state.global];
    return `<ol class="stepper">${steps.map((s, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}"><i></i>${s}</li>`).join("")}</ol>`;
  }

  function stage(ex: Extraction): string {
    const W = ex.width;
    const H = ex.height;
    const rects = ex.items
      .flatMap((it) =>
        it.boxes.map(
          (b) => `<rect data-action="toggle" data-id="${it.id}" class="box ${it.selected ? "on" : ""} ${it.kind === "fondo" ? "bg" : ""}"
            x="${b[0] * W}" y="${b[1] * H}" width="${b[2] * W}" height="${b[3] * H}" style="--c:${KIND_INK[it.kind]}"><title>${esc(it.name)}</title></rect>`,
        ),
      )
      .join("");
    const pieces = ex.analysis?.pieces ?? [];
    return `
<section class="ex-stage">
  <div class="photo ${state.global === "analyzing" ? "scanning" : ""}">
    <img src="${blobUrl(ex.source)}" alt="Foto original" />
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}</svg>
    ${state.global === "analyzing" ? `<div class="scan-badge"><span class="spin"></span><b>Analizando</b>${elapsed(state.since)}</div>` : ""}
  </div>
  <div class="stage-meta">
    <strong>${esc(ex.name)}</strong><span>${W}×${H}px</span>
    ${pieces
      .map((p) => {
        const prod = getProduct(p.productType);
        const variant = prod.variants.find((v) => v.id === p.variant)?.label;
        return `<span class="tag">${prod.label}${variant ? ` · ${variant}` : ""}${p.garmentColor ? ` <i class="sw" style="background:${p.garmentColor}"></i>` : ""}</span>`;
      })
      .join("")}
  </div>
  ${ex.analysis?.sensitive.length ? `<div class="alert">Posible información sensible: ${esc(ex.analysis.sensitive.join("; "))}</div>` : ""}
  ${state.global === "idle" ? `<button class="btn primary" data-action="analyze">Analizar foto</button>` : ""}
  ${
    state.global === "analyzing"
      ? `<div class="analyzing-note"><span>Detectando productos, superficies y artes. El análisis preciso suele tardar entre 20 s y 2 min según la foto.</span><button class="btn ghost sm" data-action="cancel-analysis">Cancelar</button></div>`
      : ""
  }
</section>`;
  }

  function card(item: ArtItem, index: number): string {
    const v = item.versions[item.active];
    const busyOn = (t: string) => state.busy.has(`${item.id}:${t}`);
    const queued = item.state === "en_cola" || item.state === "generando";
    const working = queued || itemBusy(item);
    const art = item.obj ?? null;
    const bg = item.bg ?? null;
    const colors = art?.colors ?? bg?.colors ?? [];
    const issues = [...(art?.issues ?? []), ...(art?.distortion ?? []), ...(bg?.fragments.flatMap((f) => f.issues) ?? [])];
    const text = art?.text.length ? `“${art.text.join(" / ")}”` : "";
    return `
<article class="ex-card st-${item.state}" data-id="${item.id}" style="--c:${KIND_INK[item.kind]}">
  <header>
    <label class="check"><input type="checkbox" data-action="select" data-id="${item.id}" ${item.selected ? "checked" : ""} /></label>
    <span class="kind">${KIND_LABEL[item.kind]}</span>
    <h3 title="${esc(item.name)}">${esc(item.name)}</h3>
    <span class="status">${item.state === "generando" ? `<span class="spin"></span>` : ""}${STATE_LABEL[item.state]}${item.state === "generando" && state.itemSince[item.id] ? elapsed(state.itemSince[item.id]) : ""}</span>
  </header>
  <div class="compare ${v ? "has-after" : ""}" style="--pos:50%">
    <img class="before" src="${beforeUrl(item)}" alt="Antes" loading="lazy" />
    ${v ? `<img class="after" src="${blobUrl(v.enlarged ?? v.png)}" alt="Después" /><input type="range" class="slider" min="0" max="100" value="50" aria-label="Comparar antes y después" /><span class="tag l">Antes</span><span class="tag r">Después</span>` : ""}
  </div>
  ${
    colors.length || text || item.bg?.plain
      ? `<div class="meta">${colors.map((c) => `<i class="sw" style="background:${c}" title="${c}"></i>`).join("")}${text ? `<span class="txt">${esc(text)}</span>` : ""}${item.bg?.plain ? `<span class="tag">Color liso · sin IA</span>` : ""}</div>`
      : ""
  }
  ${issues.length ? `<details class="issues"><summary>${issues.length} observación(es)</summary><ul>${issues.slice(0, 8).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : ""}
  ${item.error ? `<div class="alert sm">${esc(item.error.message)}</div>` : ""}
  ${
    item.versions.length
      ? `<div class="versions">${item.versions
          .map((ver, i) => `<button class="${i === item.active ? "on" : ""}" data-action="version" data-id="${item.id}" data-v="${i}" title="${esc(ver.feedback ?? "Primera versión")} · ${esc(ver.provider)}">v${i + 1}</button>`)
          .join("")}<span class="muted">${item.versions.length}/${CLIENT.versionsPerItem}</span></div>`
      : ""
  }
  <div class="actions">
    ${
      !v
        ? `<button class="btn primary sm" data-action="recreate" data-id="${item.id}" ${working ? "disabled" : ""}>${item.state === "error" ? "Reintentar" : "Recrear"}</button>`
        : `<button class="btn sm" data-action="upscale" data-id="${item.id}" ${working ? "disabled" : ""}>${busyOn("upscale") ? "Ampliando…" : `Ampliar${v.enlarged ? " ✓" : ""}`}</button>
           <button class="btn sm" data-action="vectorize" data-id="${item.id}" ${working ? "disabled" : ""}>${busyOn("vectorize") ? "Vectorizando…" : `Vectorizar${v.svg ? " ✓" : ""}`}</button>
           ${item.kind !== "fondo" ? `<button class="btn sm" data-action="cutout" data-id="${item.id}" ${working ? "disabled" : ""}>${busyOn("cutout") ? "Recortando…" : "Quitar fondo"}</button>` : ""}`
    }
    ${queued ? `<button class="btn ghost sm" data-action="cancel" data-id="${item.id}">Cancelar</button>` : ""}
    ${item.kind === "grupo" ? `<button class="btn ghost sm" data-action="ungroup" data-id="${item.id}">Deshacer grupo</button>` : ""}
  </div>
  ${
    v
      ? `<div class="fix">
          <textarea data-feedback="${item.id}" rows="2" placeholder="¿Qué corregir? Ej.: el texto dice “CAMPEÓN”, el rojo es más oscuro…">${esc(state.feedback[item.id] ?? "")}</textarea>
          <button class="btn sm" data-action="regenerate" data-id="${item.id}" ${working || item.versions.length >= CLIENT.versionsPerItem ? "disabled" : ""}>Regenerar</button>
        </div>
        <div class="downloads">
          ${icon("descargar", 16)}
          ${(["png", "svg", "eps", "tiff"] as Format[])
            .map((f) => `<button class="pill-btn" data-action="download" data-id="${item.id}" data-f="${f}" data-i="${index}" ${(f === "svg" || f === "eps") && !v.svg ? `disabled title="Vectorizá primero"` : ""}>${f === "tiff" ? "TIFF CMYK" : f.toUpperCase()}</button>`)
            .join("")}
        </div>
        <div class="row sends">${SEND_TARGETS.filter((t) => t.id !== "extractor")
          .map((t) => `<button class="send ink-${t.ink}" data-action="send" data-to="${t.id}" data-id="${item.id}" title="Enviar a ${esc(t.label)}">${icon(t.icon, 16)}<span>${esc(t.label)}</span></button>`)
          .join("")}</div>`
      : ""
  }
</article>`;
  }

  function panel(ex: Extraction): string {
    if (state.global === "analyzing" || !ex.analysis) {
      return `<section class="ex-panel"><div class="empty">${state.global === "analyzing" ? "Detectando productos, superficies y artes…" : "Analizá la foto para detectar los artes."}</div></section>`;
    }
    const selected = ex.items.filter((i) => i.selected);
    const pending = selected.filter((i) => !i.versions.length && i.state !== "en_cola" && i.state !== "generando").length;
    const groupable = selected.filter((i) => i.obj).length >= 2;
    const ready = ex.items.filter((i) => i.versions.length);
    const running = ex.items.filter((i) => i.state === "en_cola" || i.state === "generando").length;
    return `
<section class="ex-panel">
  <div class="toolbar">
    <button class="btn primary" data-action="recreate-selected" ${pending ? "" : "disabled"}>Recrear seleccionados (${pending})</button>
    ${groupable ? `<button class="btn sm" data-action="group" data-mode="posicion" title="Un solo arte respetando posiciones">Agrupar en posición</button><button class="btn sm" data-action="group" data-mode="lado_a_lado">Agrupar lado a lado</button>` : ""}
    <span class="spacer"></span>
    ${running ? `<span class="muted"><span class="spin"></span> ${running} en curso</span>` : ""}
    <label class="muted inline"><input type="checkbox" data-action="tiff" ${state.includeTiff ? "checked" : ""} /> TIFF en ZIP</label>
    <button class="btn" data-action="zip" ${ready.length ? "" : "disabled"}>${icon("descargar", 16)} ZIP (${ready.length})</button>
  </div>
  <div class="ex-cards">${ex.items.map((it, i) => card(it, i)).join("") || `<div class="empty">Sin elementos detectados.</div>`}</div>
</section>`;
  }

  function render() {
    if (!alive) return;
    const active = document.activeElement as HTMLTextAreaElement | null;
    const focusKey = active?.dataset?.feedback;
    const selStart = active?.selectionStart;
    const scroll = root.querySelector(".ex-cards")?.scrollTop ?? 0;

    root.innerHTML = state.ex
      ? `<div class="ex-head">${stepper()}<button class="btn ghost sm" data-action="new">${icon("mas", 16)} Nueva extracción</button></div>
         <div class="ex-work">${stage(state.ex)}${panel(state.ex)}</div>`
      : `<div class="tool-intro">
           ${dropzone({ id: "photo", title: "Soltá la foto del producto", hint: "Camiseta, taza, banner, wind banner o shorts · JPG, PNG o WEBP hasta 40 MB · también Ctrl+V" })}
         </div>`;

    const cards = root.querySelector(".ex-cards");
    if (cards) cards.scrollTop = scroll;
    if (focusKey) {
      const ta = root.querySelector<HTMLTextAreaElement>(`[data-feedback="${focusKey}"]`);
      if (ta) {
        ta.focus();
        if (selStart != null) ta.setSelectionRange(selStart, selStart);
      }
    }
    bindDrops(root, (f) => loadFile(f, f.name));
  }

  // ---------- eventos ----------
  root.addEventListener("click", async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || el.tagName === "INPUT") return;
    const id = el.dataset.id ?? "";
    const item = findItem(id);
    switch (el.dataset.action) {
      case "new":
        return reset();
      case "analyze":
        return analyze();
      case "cancel-analysis":
        return controllers.get("analysis")?.abort();
      case "toggle":
        if (item) {
          item.selected = !item.selected;
          persist();
          render();
        }
        return;
      case "recreate":
        return item && runRecreate(item, null);
      case "recreate-selected":
        return recreateSelected();
      case "regenerate": {
        if (!item) return;
        const fb = (state.feedback[id] ?? "").trim();
        if (!fb) return toast("Escribí qué hay que corregir.");
        return runRecreate(item, fb);
      }
      case "cancel":
        return controllers.get(id)?.abort();
      case "version":
        if (item) {
          item.active = Number(el.dataset.v);
          persist();
          render();
        }
        return;
      case "upscale":
      case "vectorize":
      case "cutout":
        return item && runTool(item, el.dataset.action);
      case "send": {
        const v = item?.versions[item.active];
        if (v) ctx.navigate(el.dataset.to!, { blob: v.enlarged ?? v.png, name: item!.name, svg: v.svg });
        return;
      }
      case "group": {
        const ex = state.ex!;
        try {
          const ids = ex.items.filter((i) => i.selected && i.obj).map((i) => i.id);
          const g = makeGroup(ex, ids, el.dataset.mode as GroupMode);
          ex.items.forEach((i) => ids.includes(i.id) && (i.selected = false));
          ex.items.push(g);
          persist();
          render();
        } catch (err) {
          toast((err as Error).message);
        }
        return;
      }
      case "ungroup":
        if (state.ex && item) {
          item.group?.memberIds.forEach((m) => {
            const mi = findItem(m);
            if (mi) mi.selected = true;
          });
          state.ex.items = state.ex.items.filter((i) => i.id !== id);
          persist();
          render();
        }
        return;
      case "download": {
        if (!item || !state.ex) return;
        const f = el.dataset.f as Format;
        try {
          const blob = await exportFile(item, f);
          if (blob) download(blob, `${baseName(state.ex, item, Number(el.dataset.i))}.${f === "tiff" ? "tif" : f}`);
        } catch (err) {
          toast(`No se pudo exportar: ${(err as Error).message}`);
        }
        return;
      }
      case "zip": {
        const ex = state.ex;
        if (!ex) return;
        const ready = ex.items.filter((i) => i.versions.length);
        el.setAttribute("disabled", "");
        el.textContent = "Empaquetando…";
        try {
          download(await exportZip(ex, ready, state.includeTiff), `disenoia-${baseName(ex, ready[0], 0).slice(3)}-${ex.id.slice(4, 10)}.zip`);
        } catch (err) {
          toast(`No se pudo crear el ZIP: ${(err as Error).message}`);
        }
        render();
        return;
      }
    }
  });

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.action === "select") {
      const item = findItem(el.dataset.id ?? "");
      if (item) {
        item.selected = el.checked;
        persist();
        render();
      }
    } else if (el.dataset.action === "tiff") {
      state.includeTiff = el.checked;
    }
  });

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLTextAreaElement && el.dataset.feedback) state.feedback[el.dataset.feedback] = el.value;
    if (el instanceof HTMLInputElement && el.classList.contains("slider")) {
      (el.parentElement as HTMLElement).style.setProperty("--pos", `${el.value}%`);
    }
  });

  root.addEventListener("mouseover", (e) => {
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>(".ex-card");
    root.querySelectorAll(".box.hl").forEach((b) => b.classList.remove("hl"));
    if (cardEl) root.querySelectorAll(`.box[data-id="${cardEl.dataset.id}"]`).forEach((b) => b.classList.add("hl"));
  });

  const stopPaste = onPaste(root, (f) => state.global !== "recreating" && void loadFile(f, f.name));
  ctx.onReceive((h) => void loadFile(h.blob, h.name));
  const urlId = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("id");
  // Desde la biblioteca se puede abrir otra extracción aunque el Extractor ya esté abierto.
  ctx.onShow(() => {
    const id = urlId();
    if (id && id !== state.ex?.id) void openExtraction(id);
  });

  // Entrada: extracción pedida (#/extractor?id=…), imagen enviada, o la última que estaba abierta.
  const incoming = ctx.takeHandoff();
  render();
  // (?id=… lo abre onShow, que el shell llama apenas se muestra la herramienta)
  if (incoming) void loadFile(incoming.blob, incoming.name);
  else if (!urlId())
    void session.load().then((saved) => {
      if (saved?.lastId && !state.ex) void openExtraction(saved.lastId, true);
    });

  return () => {
    alive = false;
    session.flush();
    stopPaste();
    cancelAll();
    state.bitmap?.close();
  };
};
