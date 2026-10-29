// Utilidades mínimas de interfaz: escape, URLs de blobs cacheadas y avisos.

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const urls = new WeakMap<Blob, string>();

/** URL de objeto reutilizable por blob (evita fugas al re-renderizar). */
export function blobUrl(b: Blob): string {
  let u = urls.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    urls.set(b, u);
  }
  return u;
}

export function toast(message: string, kind: "error" | "ok" = "error") {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add("out"), 4200);
  setTimeout(() => el.remove(), 4700);
}

export const fmtDate = (t: number) =>
  new Date(t).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const KIND_LABEL: Record<string, string> = {
  fondo: "Fondo",
  logo: "Logo",
  texto: "Texto",
  parche: "Parche",
  etiqueta: "Etiqueta",
  figura: "Figura",
  grupo: "Grupo",
};

export const STATE_LABEL: Record<string, string> = {
  detectado: "Detectado",
  en_cola: "En cola",
  generando: "Generando…",
  listo: "Listo",
  error: "Error",
};
