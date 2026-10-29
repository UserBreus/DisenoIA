// Shell de la app: riel de herramientas, barra superior, rutas por hash y acciones globales.
import { imageSize } from "../core/imaging";
import { loadSettings, codexUrl, type Settings } from "../core/settings";
import { getAsset, saveAsset, type Asset } from "../core/store";
import { uid } from "../core/queue";
import { download, exportAsset } from "../export";
import { codexHealth } from "../providers/codex";
import { toast } from "../ui/dom";
import { bindSettings, settingsHtml } from "../ui/settings";
import { icon } from "./icons";
import { HOME, TOOLS, toolById, type Handoff, type ToolContext, type ToolDef } from "./tools";
import { esc, fmtElapsed, slugName } from "./ui";
import { mark } from "./wordmark";

let settings: Settings = loadSettings();
let handoff: Handoff | null = null;
/** Resultados recientes en memoria (además de la biblioteca), para descargar/enviar sin leer la base. */
const cache = new Map<string, Asset>();

const ctx: Omit<ToolContext, "onReceive" | "onShow"> = {
  settings: () => settings,
  navigate(id, h) {
    handoff = h ?? null;
    location.hash = id === HOME.id ? "#/" : `#/${id}`;
  },
  takeHandoff() {
    const h = handoff;
    handoff = null;
    return h;
  },
  async keep(a) {
    const size = a.width && a.height ? { width: a.width, height: a.height } : await imageSize(a.blob).catch(() => ({ width: 0, height: 0 }));
    const asset: Asset = { ...a, ...size, id: uid("as-"), createdAt: Date.now() };
    cache.set(asset.id, asset);
    await saveAsset(asset);
    return asset;
  },
  openSettings,
};

export function startApp(root: HTMLElement) {
  root.innerHTML = `
<div class="app">
  <nav class="rail" aria-label="Herramientas">
    <a class="rail-mark" href="#/" title="Inicio">${mark()}</a>
    <div class="rail-tools">
      ${[HOME, ...TOOLS].map(railButton).join("")}
    </div>
    <button class="rail-btn" data-open-settings title="Ajustes">${icon("ajustes")}</button>
  </nav>
  <div class="frame">
    <header class="topbar">
      <div class="tool-chip" id="tool-chip"></div>
      <button class="status" id="status" data-open-settings title="Proveedores de IA"></button>
    </header>
    <main class="view" id="view"></main>
  </div>
</div>
<dialog id="settings"></dialog>`;

  root.addEventListener("click", onGlobalClick);
  // Reloj global: actualiza todos los contadores de tiempo visibles sin volver a dibujar las herramientas.
  window.setInterval(() => {
    const now = Date.now();
    document.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => (el.textContent = fmtElapsed(now - Number(el.dataset.since))));
  }, 1000);
  window.addEventListener("hashchange", route);
  route();
  void refreshStatus();
}

const railButton = (t: ToolDef) =>
  `<a class="rail-btn ink-${t.ink}" href="${t.id === HOME.id ? "#/" : `#/${t.id}`}" data-tool="${t.id}" title="${esc(t.label)} — ${esc(t.desc)}">${icon(t.icon)}<span class="rail-tip">${esc(t.label)}</span></a>`;

/** Herramienta montada: queda viva (oculta) al cambiar, así no se pierde el trabajo ni lo que está en curso. */
interface Instance {
  tool: ToolDef;
  root: HTMLElement;
  ready: Promise<void>;
  receive?: (h: Handoff) => void;
  show?: () => void;
  cleanup?: () => void;
}
const instances = new Map<string, Instance>();

function mountTool(tool: ToolDef, view: HTMLElement): Instance {
  const root = document.createElement("div");
  root.className = `pane pane-${tool.id}`;
  root.innerHTML = `<div class="busy center"><span class="spin"></span></div>`;
  view.appendChild(root);
  const inst: Instance = { tool, root, ready: Promise.resolve() };
  const toolCtx: ToolContext = {
    ...ctx,
    onReceive: (fn) => (inst.receive = fn),
    onShow: (fn) => (inst.show = fn),
  };
  inst.ready = tool
    .load()
    .then((mod) => {
      root.innerHTML = "";
      const c = mod.mount(root, toolCtx);
      if (typeof c === "function") inst.cleanup = c;
    })
    .catch((e: unknown) => {
      // No se pudo cargar (servidor de desarrollo apagado, red caída o versión nueva publicada):
      // se avisa con un botón para reintentar en vez de dejar un error sin manejar.
      console.warn(`[DiseñoIA] no se pudo abrir ${tool.label}:`, e);
      instances.delete(tool.id);
      root.innerHTML = `<div class="load-error"><b>No se pudo abrir ${esc(tool.label)}</b>
        <p>La aplicación no encontró sus archivos. Si la abriste desde el servidor de desarrollo, puede que esté apagado: usá <code>http://127.0.0.1:8787</code> o recargá la página.</p>
        <button class="btn primary" data-retry-tool>Reintentar</button></div>`;
      root.querySelector("[data-retry-tool]")?.addEventListener("click", () => {
        root.remove();
        void route();
      });
    });
  instances.set(tool.id, inst);
  return inst;
}

const currentTool = () => toolById(location.hash.replace(/^#\/?/, "").split("?")[0] || HOME.id) ?? HOME;

async function route() {
  const tool = currentTool();
  document.querySelectorAll<HTMLElement>(".rail-btn[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool.id));
  document.getElementById("tool-chip")!.innerHTML =
    tool.id === HOME.id
      ? ""
      : `<span class="chip-icon ink-${tool.ink}">${icon(tool.icon, 18)}</span><span><b>${esc(tool.label)}</b><small>${esc(tool.desc)}</small></span>`;
  document.title = tool.id === HOME.id ? "DiseñoIA" : `${tool.label} · DiseñoIA`;
  const view = document.getElementById("view")!;
  view.className = `view view-${tool.id}`;

  const existing = instances.get(tool.id);
  const inst = existing ?? mountTool(tool, view);
  for (const other of instances.values()) other.root.hidden = other !== inst;
  view.scrollTop = 0;
  await inst.ready;
  if (currentTool() !== tool) return; // el usuario ya cambió de herramienta mientras cargaba
  // Si ya estaba abierta, la imagen enviada le llega sin perder lo que tenía.
  if (existing && handoff && inst.receive) inst.receive(ctx.takeHandoff()!);
  inst.show?.();
}

async function findAsset(id: string): Promise<Asset | undefined> {
  return cache.get(id) ?? (await getAsset(id));
}

async function onGlobalClick(e: Event) {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-dl],[data-send],[data-open-settings]");
  if (!el) return;
  if (el.hasAttribute("data-open-settings")) return openSettings();
  const asset = await findAsset(el.dataset.asset ?? "");
  if (!asset) return toast("No encontré ese archivo en la biblioteca.");
  if (el.dataset.dl) {
    try {
      const blob = await exportAsset(asset, el.dataset.dl);
      if (!blob) return toast("Ese formato necesita el vector: usá el Vectorizador.");
      download(blob, `${slugName(asset.name)}.${el.dataset.dl === "tiff" ? "tif" : el.dataset.dl}`);
    } catch (err) {
      toast(`No se pudo exportar: ${(err as Error).message}`);
    }
  } else if (el.dataset.send) {
    ctx.navigate(el.dataset.send, { blob: asset.blob, name: asset.name, svg: asset.svg });
  }
}

function openSettings() {
  const dialog = document.getElementById("settings") as HTMLDialogElement;
  dialog.innerHTML = settingsHtml(settings);
  bindSettings(dialog, settings, (s) => {
    settings = s;
    toast("Ajustes guardados.", "ok");
    void refreshStatus();
  });
  dialog.showModal();
}

/** Indicador de proveedor: muestra si Codex está conectado (o el proveedor elegido). */
async function refreshStatus() {
  const el = document.getElementById("status");
  if (!el) return;
  const usesCodex = settings.analysis.provider === "codex" || settings.image.provider === "codex";
  const label = (p: string) => ({ codex: "Codex", demo: "Demo", gemini: "Gemini", openai: "OpenAI", anthropic: "Claude", fal: "FAL" })[p] ?? p;
  const providers = [...new Set([label(settings.analysis.provider), label(settings.image.provider)])].join(" + ");
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span><b>${esc(providers)}</b><small>${usesCodex ? "comprobando…" : "proveedor activo"}</small></span>${icon("ajustes", 16)}`;
  if (!usesCodex) return el.classList.remove("off");
  const h = await codexHealth(codexUrl(settings));
  el.classList.toggle("off", !h.ok);
  el.querySelector("small")!.textContent = h.ok ? "conectado" : "puente apagado · npm run codex";
}
