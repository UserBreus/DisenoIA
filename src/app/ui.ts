// Piezas de interfaz compartidas por las herramientas (HTML en texto + delegación de eventos).
import { ACCEPTED_TYPES } from "../core/limits";
import type { Asset } from "../core/store";
import { blobUrl, esc } from "../ui/dom";
import { ProviderError } from "../core/types";
import { FAILURE_LABELS } from "../providers/http";
import { icon } from "./icons";
import { SEND_TARGETS } from "./tools";

export { esc };

export interface DropOptions {
  id: string;
  title: string;
  hint?: string;
  compact?: boolean;
}

export const dropzone = (o: DropOptions) => `
<label class="drop ${o.compact ? "compact" : ""}" data-drop="${o.id}">
  <input type="file" accept="${ACCEPTED_TYPES.join(",")}" hidden />
  <span class="drop-icon">${icon("subir", 22)}</span>
  <span class="drop-title">${esc(o.title)}</span>
  ${o.hint ? `<span class="drop-hint">${esc(o.hint)}</span>` : ""}
</label>`;

/** Conecta todas las zonas de carga de `root`: clic, arrastrar y soltar. */
export function bindDrops(root: HTMLElement, onFile: (file: File, dropId: string) => void) {
  root.querySelectorAll<HTMLElement>("[data-drop]").forEach((zone) => {
    const id = zone.dataset.drop!;
    const input = zone.querySelector("input")!;
    input.addEventListener("change", () => {
      if (input.files?.[0]) onFile(input.files[0], id);
      input.value = "";
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f, id);
    });
  });
}

/**
 * Pegar una imagen con Ctrl+V. Sólo actúa la herramienta visible (las demás siguen vivas pero ocultas).
 * Devuelve la función para desconectarlo.
 */
export function onPaste(root: HTMLElement, fn: (file: File) => void): () => void {
  const handler = (e: ClipboardEvent) => {
    if (!root.isConnected || root.closest("[hidden]")) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) fn(file);
  };
  window.addEventListener("paste", handler);
  return () => window.removeEventListener("paste", handler);
}

export const chips = (name: string, options: readonly { id: string; label: string }[], value: string) =>
  `<div class="chips" role="radiogroup">${options
    .map((o) => `<button type="button" class="chip ${o.id === value ? "on" : ""}" data-chip="${name}" data-value="${o.id}" role="radio" aria-checked="${o.id === value}">${esc(o.label)}</button>`)
    .join("")}</div>`;

/** Contador "12 s" / "1:05" que el shell actualiza cada segundo (data-since = inicio en ms). */
export const elapsed = (since: number) => `<span class="elapsed" data-since="${since}">${fmtElapsed(Date.now() - since)}</span>`;

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const busy = (text: string, since?: number) =>
  `<div class="busy"><span class="spin"></span><span>${esc(text)}</span>${since ? elapsed(since) : ""}</div>`;

/** Formatos disponibles para un archivo de la biblioteca. */
export const formatsFor = (a: Pick<Asset, "svg">) => (a.svg ? ["png", "svg", "eps", "pdf", "tiff"] : ["png", "tiff"]);

/** Botones de descarga y "Enviar a…" para un resultado guardado. */
export function resultActions(a: Asset, opts: { exclude?: string } = {}) {
  const fmts = formatsFor(a)
    .map((f) => `<button class="pill-btn" data-dl="${f}" data-asset="${a.id}">${f === "tiff" ? "TIFF CMYK" : f.toUpperCase()}</button>`)
    .join("");
  const sends = SEND_TARGETS.filter((t) => t.id !== opts.exclude)
    .map((t) => `<button class="send ink-${t.ink}" data-send="${t.id}" data-asset="${a.id}" title="Enviar a ${esc(t.label)}">${icon(t.icon, 16)}<span>${esc(t.label)}</span></button>`)
    .join("");
  return `<div class="result-actions"><div class="row">${icon("descargar", 16)}${fmts}</div><div class="row sends">${sends}</div></div>`;
}

/** Lector de archivos sencillo para el estado de las herramientas. */
export interface Picked {
  blob: Blob;
  name: string;
  url: string;
}

export function picked(blob: Blob, name: string): Picked {
  return { blob, name: name.replace(/\.[^.]+$/, "") || "imagen", url: URL.createObjectURL(blob) };
}

export const slugName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "archivo";

/** Mensaje legible de un error de proveedor. */
export function errorText(e: unknown): string {
  if (e instanceof ProviderError) return `${FAILURE_LABELS[e.code] ?? FAILURE_LABELS.unknown}: ${e.message}`;
  return (e as Error)?.message ?? String(e);
}

/** Disposición estándar: área de trabajo + panel lateral (el panel sólo existe si tiene contenido). */
export const layout = (main: string, side?: string) =>
  `<div class="tool ${side ? "" : "solo"}"><section class="tool-main">${main}</section>${side ? `<aside class="tool-side">${side}</aside>` : ""}</div>`;

/** Tarjeta de resultado con vista previa y acciones. */
export function resultCard(a: Asset, opts: { exclude?: string; caption?: string; extra?: string } = {}) {
  const src = a.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.svg)}` : blobUrl(a.blob);
  return `<article class="result">
    <div class="result-img checker"><img src="${src}" alt="${esc(a.name)}" loading="lazy" /></div>
    <div class="result-body">
      <div class="result-title"><b>${esc(a.name)}</b><small>${a.width}×${a.height}px${opts.caption ? ` · ${esc(opts.caption)}` : ""}</small></div>
      ${opts.extra ?? ""}
      ${resultActions(a, { exclude: opts.exclude })}
    </div>
  </article>`;
}

export const section = (title: string, body: string) => `<section class="panel-sec"><h4>${esc(title)}</h4>${body}</section>`;
