// Vectorizador.
// Preciso (IA por objeto): analiza los elementos → la IA redibuja cada uno apto para vector →
// se traza color por color → se unen en su lugar con sus colores. Rápido: motor propio sin IA.
import { icon } from "../app/icons";
import type { Mount } from "../app/tools";
import { bindDrops, busy, chips, dropzone, elapsed, errorText, esc, layout, onPaste, picked, resultActions, section, type Picked } from "../app/ui";
import { imageSize, rasterizeSvg, vectorizeImage } from "../core/imaging";
import { toolSession } from "../core/session";
import { getAsset, saveAsset, type Asset } from "../core/store";
import { composeSvg, needsPrep, planObjects, prepThumb, prepareObject, traceObject, type BgSource, type VecObject, type VecPlan } from "../core/vector/pipeline";
import { toast } from "../ui/dom";

type Mode = "preciso" | "rapido";

const STATUS_LABEL: Record<string, string> = {
  pendiente: "En espera",
  preparando: "IA preparando",
  vectorizando: "Vectorizando",
  listo: "Listo",
  error: "Error",
};

export const mount: Mount = (root, ctx) => {
  const s = {
    input: null as Picked | null,
    mode: (ctx.settings().image.provider === "demo" ? "rapido" : "preciso") as Mode,
    detail: 0.9,
    bgSource: "original" as BgSource,
    colors: 12,
    keepBg: true,
    plan: null as VecPlan | null,
    thumbs: {} as Record<string, string>,
    svg: "",
    asset: null as Asset | null,
    phase: "",
    since: 0,
    running: false,
    pos: 50,
  };
  let ctrl: AbortController | null = null;
  let retraceTimer = 0;

  // ---------- caché ----------
  type SavedObj = Omit<VecObject, "traced" | "seps">;
  const session = toolSession<{
    input: Blob | null;
    name: string;
    mode: Mode;
    detail: number;
    colors: number;
    keepBg: boolean;
    bgSource: BgSource;
    plan: (Omit<VecPlan, "objects"> & { objects: SavedObj[] }) | null;
    assetId: string | null;
  }>("vectorizador-v2");
  const persist = () =>
    session.save({
      input: s.input?.blob ?? null,
      name: s.input?.name ?? "",
      mode: s.mode,
      detail: s.detail,
      colors: s.colors,
      keepBg: s.keepBg,
      bgSource: s.bgSource,
      // Lo caro (la imagen preparada por IA) se guarda; el trazado se recalcula en segundos.
      plan: s.plan
        ? { ...s.plan, objects: s.plan.objects.map(({ traced: _t, seps: _s, ...o }) => ({ ...o, status: o.prep ? "pendiente" : o.status === "error" ? "error" : "pendiente" })) }
        : null,
      assetId: s.asset?.id ?? null,
    });

  function setInput(blob: Blob, name: string) {
    ctrl?.abort();
    if (s.input) URL.revokeObjectURL(s.input.url);
    s.input = picked(blob, name);
    Object.assign(s, { plan: null, thumbs: {}, svg: "", asset: null, running: false, phase: "" });
    persist();
    render();
  }

  // ---------- flujo ----------
  async function saveResult(svg: string, fresh: boolean) {
    s.svg = svg;
    const png = await rasterizeSvg(svg);
    const meta = { mode: s.mode, colors: s.colors, detail: s.detail, objects: s.plan?.objects.length ?? 0 };
    if (s.asset && !fresh) {
      // Retoque del mismo vector: se actualiza el archivo en lugar de llenar la biblioteca de copias.
      Object.assign(s.asset, { blob: png, svg, meta });
      await saveAsset(s.asset);
    } else {
      s.asset = await ctx.keep({ tool: "vectorizador", name: `${s.input!.name} vector`, blob: png, svg, meta });
    }
  }

  async function runPrecise(signal: AbortSignal) {
    const input = s.input!;
    const { width, height } = await imageSize(input.blob);
    if (!s.plan) {
      s.phase = "Analizando los objetos de la imagen…";
      render();
      s.plan = await planObjects(ctx.settings(), input.blob, width, height, signal);
      persist();
    }
    const plan = s.plan;
    const src = await createImageBitmap(input.blob);
    try {
      // Paso 2: la IA redibuja cada objeto apto para vector (en paralelo; el puente los encola).
      const missing = plan.objects.filter((o) => !o.prep && needsPrep(o, s.bgSource));
      if (missing.length) {
        s.phase = `La IA está preparando ${missing.length} objeto${missing.length > 1 ? "s" : ""} para el vectorizado…`;
        render();
        await Promise.all(
          missing.map(async (o) => {
            o.status = "preparando";
            o.since = Date.now();
            o.error = undefined;
            render();
            try {
              o.prep = await prepareObject(ctx.settings(), src, plan, o, signal);
              s.thumbs[o.id] = await prepThumb(o.prep);
              o.status = "pendiente";
            } catch (e) {
              if (signal.aborted) throw e;
              o.status = "error";
              o.error = errorText(e);
            }
            persist();
            render();
          }),
        );
      }
    } finally {
      src.close();
    }
    await traceAll(signal);
  }

  /** Pasos 3 y 4: vectoriza cada objeto por color y los une. No usa IA (rápido al retocar). */
  async function traceAll(signal?: AbortSignal) {
    const plan = s.plan!;
    s.phase = "Separando cada objeto en imágenes de un solo color y vectorizándolas…";
    render();
    const source = await createImageBitmap(s.input!.blob);
    const order = [...plan.objects.filter((o) => o.kind !== "fondo"), ...plan.objects.filter((o) => o.kind === "fondo")];
    try {
      for (const o of order) {
        if (signal?.aborted || (needsPrep(o, s.bgSource) && !o.prep)) continue;
        o.status = "vectorizando";
        o.since = Date.now();
        render();
        try {
          const out = await traceObject(plan, o, s.detail, s.colors, { source, bgSource: s.bgSource });
          o.traced = out.traced;
          o.seps = out.seps;
          // El fondo tomado del original no pasa por la IA: su miniatura es la imagen original.
          if (!s.thumbs[o.id] && !needsPrep(o, s.bgSource)) s.thumbs[o.id] = await prepThumb(s.input!.blob);
          o.status = "listo";
        } catch (e) {
          o.status = "error";
          o.error = errorText(e);
        }
      }
    } finally {
      source.close();
    }
    if (!plan.objects.some((o) => o.traced)) throw new Error("Ningún objeto se pudo preparar. Revisá el proveedor de imágenes.");
    s.phase = "Uniendo los objetos…";
    render();
    await saveResult(composeSvg(plan, s.keepBg), !s.asset);
  }

  async function run(opts: { reanalyze?: boolean } = {}) {
    if (!s.input || s.running) return;
    if (opts.reanalyze) {
      s.plan = null;
      s.thumbs = {};
    }
    ctrl = new AbortController();
    s.running = true;
    s.since = Date.now();
    render();
    try {
      if (s.mode === "rapido") {
        s.phase = "Vectorizando por color…";
        render();
        await saveResult(await vectorizeImage(ctx.settings(), s.input.blob, { colors: s.colors, simplify: 1 - s.detail }, ctrl.signal), !s.asset);
      } else {
        await runPrecise(ctrl.signal);
      }
      toast("Vector listo: líneas limpias en SVG, EPS y PDF.", "ok");
    } catch (e) {
      if (!ctrl.signal.aborted) toast(errorText(e));
    } finally {
      s.running = false;
      s.phase = "";
      ctrl = null;
      persist();
      render();
    }
  }

  /** Rehace con IA un solo objeto (si salió mal) y vuelve a unir. */
  async function redoObject(id: string) {
    const o = s.plan?.objects.find((x) => x.id === id);
    if (!o || s.running) return;
    o.prep = undefined;
    o.traced = undefined;
    delete s.thumbs[id];
    await run();
  }

  /** Detalle, colores o fondo cambiaron: se vuelve a trazar sin gastar IA. */
  function retrace(force = false) {
    if (s.running || (!s.svg && !force)) return;
    clearTimeout(retraceTimer);
    retraceTimer = window.setTimeout(async () => {
      if (s.mode === "rapido" || !s.plan?.objects.some((o) => o.prep || !needsPrep(o, s.bgSource))) return run();
      if (s.plan.objects.some((o) => needsPrep(o, s.bgSource) && !o.prep)) return run();
      s.running = true;
      s.since = Date.now();
      try {
        await traceAll();
      } catch (e) {
        toast(errorText(e));
      } finally {
        s.running = false;
        s.phase = "";
        persist();
        render();
      }
    }, 450);
  }

  // ---------- vista ----------
  function objectCard(o: VecObject) {
    const working = o.status === "preparando" || o.status === "vectorizando";
    return `<article class="vobj st-${o.status}">
      <div class="vobj-img checker">${s.thumbs[o.id] ? `<img src="${s.thumbs[o.id]}" alt=""/>` : `<span>${working ? '<span class="spin"></span>' : icon("vectorizador", 22)}</span>`}</div>
      <div class="vobj-body">
        <b title="${esc(o.name)}">${esc(o.name)}</b>
        <small>${esc(o.kind === "fondo" ? "fondo" : o.kind)}${o.text ? ` · “${esc(o.text)}”` : ""}</small>
        <div class="meta">${o.colors
          .map((c) => `<button class="sw toggle-sw ${o.off?.includes(c) ? "off" : ""}" style="background:${c}" data-swatch="${o.id}" data-color="${c}" title="${o.off?.includes(c) ? "Activar" : "Quitar"} ${c}"></button>`)
          .join("")}</div>
        <span class="vobj-status">${working ? '<span class="spin"></span>' : ""}${o.status === "pendiente" && o.prep ? "IA lista · por vectorizar" : STATUS_LABEL[o.status]}${working && o.since ? elapsed(o.since) : ""}${o.traced ? ` · ${o.traced.layers.length} separaciones` : ""}</span>
        ${o.error ? `<small class="err">${esc(o.error)}</small>` : ""}
        ${
          o.seps?.length
            ? `<div class="seps" title="Imágenes de un solo color: cada una se vectoriza por separado y se pinta con su color">${o.seps
                .map((sp) => `<figure class="sep"><img src="${sp.thumb}" alt=""/><figcaption><i class="sw" style="background:${sp.color}"></i>${sp.pct < 1 ? sp.pct.toFixed(1) : Math.round(sp.pct)}%</figcaption></figure>`)
                .join("")}</div>`
            : ""
        }
        ${!s.running && (o.prep || o.status === "error") ? `<button class="pill-btn" data-redo="${o.id}">${icon("recreador", 14)} Rehacer con IA</button>` : ""}
      </div>
    </article>`;
  }

  function render() {
    const vectorSrc = s.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}` : "";
    const plan = s.plan;
    const main = !s.input
      ? `<div class="tool-intro">${dropzone({ id: "img", title: "Soltá la imagen a vectorizar", hint: "Logos, letterings, escudos e ilustraciones · también Ctrl+V" })}</div>`
      : `<div class="canvas-card">
          <div class="compare big ${s.svg ? "has-after" : ""}" style="--pos:${s.pos}%">
            <img class="before" src="${s.input.url}" alt="Original" />
            ${s.svg ? `<img class="after" src="${vectorSrc}" alt="Vector" /><input type="range" class="slider" min="0" max="100" value="${s.pos}" aria-label="Comparar" /><span class="tag l">Original</span><span class="tag r">Vector</span>` : ""}
          </div>
          ${s.running ? busy(s.phase || "Trabajando…", s.since) : ""}
        </div>
        ${
          plan && s.mode === "preciso"
            ? `<section class="vsteps">
                <h4>Objetos detectados · ${plan.objects.length}${plan.background.type === "solid" && plan.background.color ? ` · fondo liso <i class="sw" style="background:${plan.background.color}"></i>` : plan.background.type === "complex" ? " · fondo complejo" : ""}</h4>
                <div class="vobjs">${plan.objects.map(objectCard).join("")}</div>
              </section>`
            : ""
        }`;
    const stats = s.svg
      ? `<p class="hint">${plan && s.mode === "preciso" ? `${plan.objects.filter((o) => o.traced).length} objetos · ` : ""}${(s.svg.match(/<path/g) ?? []).length} capas de color · ${(s.svg.length / 1024).toFixed(0)} KB</p>`
      : "";
    const side = s.input
      ? section(
          "Modo",
          `${chips("mode", [{ id: "preciso", label: "Preciso · IA por objeto" }, { id: "rapido", label: "Rápido · sin IA" }], s.mode)}
           <p class="hint">${
             s.mode === "preciso"
               ? "La IA separa cada objeto, lo redibuja con colores sólidos y bordes perfectos, y recién ahí se traza color por color. Tarda más, pero las líneas salen limpias."
               : "Vectoriza la imagen tal como está, color por color, en segundos."
           }</p>`,
        ) +
        section(
          "Ajustes",
          `<label class="field">Detalle <b>${Math.round(s.detail * 100)}%</b><input type="range" min="0" max="100" value="${Math.round(s.detail * 100)}" data-k="detail"/></label>
           <label class="field">Colores máximos <b>${s.colors}</b><input type="range" min="2" max="32" value="${s.colors}" data-k="colors"/></label>
           ${s.mode === "preciso" ? `<label class="toggle"><input type="checkbox" data-k="keepBg" ${s.keepBg ? "checked" : ""}/> <span>Conservar el fondo</span></label>` : ""}
           ${
             s.mode === "preciso" && s.plan?.background.type === "complex"
               ? `<span class="label">Fondo</span>${chips("bgSource", [{ id: "original", label: "Del original (fiel)" }, { id: "ia", label: "Redibujado con IA" }], s.bgSource)}
                  <p class="hint">${s.bgSource === "original" ? "Se separa por color desde la imagen original: no se inventan dibujos ni colores." : "La IA lo redibuja plano antes de separarlo (más limpio, pero puede cambiar detalles)."}</p>`
               : ""
           }
           <p class="hint">Cambiar estos ajustes o apagar un color (tocá su muestra en cada objeto) vuelve a separar y trazar al instante, sin volver a usar IA.</p>
           <button class="btn primary block" data-act="run" ${s.running ? "disabled" : ""}>${icon("vectorizador", 16)} ${s.svg ? "Volver a vectorizar" : "Vectorizar"}</button>
           ${s.running ? `<button class="btn ghost block" data-act="stop">Cancelar</button>` : ""}
           ${plan && s.mode === "preciso" && !s.running ? `<button class="btn ghost block" data-act="reanalyze">Analizar de nuevo</button>` : ""}
           <button class="btn ghost block" data-act="clear">Otra imagen</button>`,
        ) +
        (s.asset ? section("Descargar", `${stats}${resultActions(s.asset, { exclude: "vectorizador" })}`) : "")
      : undefined;
    root.innerHTML = layout(main, side);
    bindDrops(root, (f) => setInput(f, f.name));
  }

  // ---------- eventos ----------
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-chip=mode]");
    if (chip && !s.running) {
      s.mode = chip.dataset.value as Mode;
      persist();
      return render();
    }
    const sw = t.closest<HTMLElement>("[data-swatch]");
    if (sw && !s.running) {
      const o = s.plan?.objects.find((x) => x.id === sw.dataset.swatch);
      if (!o) return;
      const c = sw.dataset.color!;
      o.off = o.off?.includes(c) ? o.off.filter((x) => x !== c) : [...(o.off ?? []), c];
      if (o.colors.every((x) => o.off!.includes(x))) {
        o.off = o.off.filter((x) => x !== c);
        return toast("Cada objeto necesita al menos un color.");
      }
      persist();
      render();
      return retrace(true);
    }
    const bgChip = t.closest<HTMLElement>("[data-chip=bgSource]");
    if (bgChip && !s.running) {
      s.bgSource = bgChip.dataset.value as BgSource;
      persist();
      render();
      return retrace(true);
    }
    const redo = t.closest<HTMLElement>("[data-redo]");
    if (redo) return void redoObject(redo.dataset.redo!);
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "run") void run();
    else if (act === "reanalyze") void run({ reanalyze: true });
    else if (act === "stop") ctrl?.abort();
    else if (act === "clear") {
      ctrl?.abort();
      s.input = null;
      Object.assign(s, { plan: null, thumbs: {}, svg: "", asset: null });
      persist();
      render();
    }
  });
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.classList.contains("slider")) {
      s.pos = Number(el.value);
      (el.parentElement as HTMLElement).style.setProperty("--pos", `${el.value}%`);
      return;
    }
    const k = el.dataset.k;
    if (k === "detail") s.detail = Number(el.value) / 100;
    else if (k === "colors") s.colors = Number(el.value);
    else return;
    const b = el.closest("label")?.querySelector("b");
    if (b) b.textContent = k === "detail" ? `${el.value}%` : el.value;
    persist();
    retrace();
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k !== "keepBg") return;
    s.keepBg = el.checked;
    persist();
    if (s.plan?.objects.some((o) => o.traced)) void saveResult(composeSvg(s.plan, s.keepBg), false).then(render);
  });

  const stop = onPaste(root, (f) => setInput(f, f.name));
  ctx.onReceive((h) => setInput(h.blob, h.name));

  async function restore() {
    const saved = await session.load();
    if (saved && !s.input) {
      Object.assign(s, { mode: saved.mode, detail: saved.detail, colors: saved.colors, keepBg: saved.keepBg, bgSource: saved.bgSource ?? "original", plan: saved.plan });
      if (saved.input) s.input = picked(saved.input, saved.name);
      const asset = saved.assetId ? await getAsset(saved.assetId) : undefined;
      if (asset?.svg) {
        s.asset = asset;
        s.svg = asset.svg;
      }
      for (const o of s.plan?.objects ?? []) if (o.prep) s.thumbs[o.id] = await prepThumb(o.prep);
    }
    render();
  }

  const h = ctx.takeHandoff();
  if (h) setInput(h.blob, h.name);
  else void restore();
  return () => {
    ctrl?.abort();
    stop();
    session.flush();
    clearTimeout(retraceTimer);
  };
};
