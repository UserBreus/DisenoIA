// Exportación por elemento (PNG, SVG, EPS, TIFF CMYK) y paquete ZIP.
import { surfaceLabel } from "../core/catalog";
import { blobToCanvas, getImageData } from "../core/image";
import type { ArtItem, Extraction } from "../core/types";
import { svgToEps, svgToPdf } from "./eps";
import { encodeCmykTiff } from "./tiff";
import { makeZip, type ZipEntry } from "./zip";

export type Format = "png" | "svg" | "eps" | "tiff";

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "arte";

export function baseName(ex: Extraction, item: ArtItem, index: number): string {
  const piece = ex.analysis?.pieces.find((p) => p.id === item.pieceId);
  const label = item.bg && piece ? `fondo-${surfaceLabel(piece.productType, item.bg.surface)}` : item.name;
  return `${String(index + 1).padStart(2, "0")}-${slug(label)}`;
}

export async function exportFile(item: ArtItem, format: Format): Promise<Blob | null> {
  const v = item.versions[item.active];
  if (!v) return null;
  switch (format) {
    case "png":
      return v.enlarged ?? v.png;
    case "svg":
      return v.svg ? new Blob([v.svg], { type: "image/svg+xml" }) : null;
    case "eps":
      return v.svg ? new Blob([svgToEps(v.svg, item.name)], { type: "application/postscript" }) : null;
    case "tiff":
      return encodeCmykTiff(getImageData(await blobToCanvas(v.enlarged ?? v.png)));
  }
}

export async function exportZip(ex: Extraction, items: ArtItem[], includeTiff: boolean): Promise<Blob> {
  const entries: ZipEntry[] = [];
  for (const [i, item] of items.entries()) {
    const name = baseName(ex, item, i);
    for (const fmt of ["png", "svg", "eps", ...(includeTiff ? ["tiff" as const] : [])] as Format[]) {
      const blob = await exportFile(item, fmt);
      if (blob) entries.push({ name: `${name}.${fmt === "tiff" ? "tif" : fmt}`, data: blob });
    }
  }
  entries.push({
    name: "LEEME.txt",
    data: `DiseñoIA — ${ex.name}\nExportado: ${new Date().toLocaleString()}\nPNG/SVG/EPS en RGB. TIFF en CMYK básico a 300 ppp (sin perfil ICC: verificá en tu RIP).\n`,
  });
  return makeZip(entries);
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Exporta un archivo de la biblioteca en el formato pedido. */
export async function exportAsset(a: { blob: Blob; svg?: string; name: string }, format: string): Promise<Blob | null> {
  switch (format) {
    case "png":
      return a.blob;
    case "tiff":
      return encodeCmykTiff(getImageData(await blobToCanvas(a.blob)));
    case "svg":
      return a.svg ? new Blob([a.svg], { type: "image/svg+xml" }) : null;
    case "eps":
      return a.svg ? new Blob([svgToEps(a.svg, a.name)], { type: "application/postscript" }) : null;
    case "pdf":
      return a.svg ? svgToPdf(a.svg) : null;
    default:
      return null;
  }
}
