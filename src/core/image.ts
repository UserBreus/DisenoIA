// Núcleo de imagen con Canvas 2D: validación, normalización, recortes, máscaras y compresión.
import { ACCEPTED_TYPES, CROP, PHOTO, REFERENCE } from "./limits";
import type { Box } from "./types";

export class ImageError extends Error {
  constructor(public code: "image_type" | "photo_too_heavy" | "photo_too_large" | "image_too_heavy" | "references_missing", message: string) {
    super(message);
  }
}

export type Img = ImageBitmap | HTMLCanvasElement;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [c, ctx];
}

export async function validatePhoto(file: Blob): Promise<ImageBitmap> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageError("image_type", "Formato no admitido. Usá JPG, PNG o WEBP.");
  }
  if (file.size > PHOTO.maxBytes) {
    throw new ImageError("photo_too_heavy", `La foto pesa más de ${Math.round(PHOTO.maxBytes / 1048576)} MB.`);
  }
  const bitmap = await createImageBitmap(file);
  if ((bitmap.width * bitmap.height) / 1e6 > PHOTO.maxMegapixels) {
    bitmap.close();
    throw new ImageError("photo_too_large", `La foto supera los ${PHOTO.maxMegapixels} megapíxeles.`);
  }
  return bitmap;
}

export function scaleToLongest(img: Img, longest: number, upscale = false): HTMLCanvasElement {
  const s = Math.max(img.width, img.height);
  const k = !upscale && s <= longest ? 1 : longest / s;
  const [c, ctx] = makeCanvas(img.width * k, img.height * k);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo codificar la imagen."))), type, quality));

export const blobToDataURL = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/** Foto normalizada para el análisis: lado mayor 1500 px, JPEG. */
export async function normalizeForAnalysis(img: Img): Promise<string> {
  const c = scaleToLongest(img, PHOTO.normalizedLongestSide);
  return blobToDataURL(await canvasToBlob(c, "image/jpeg", 0.9));
}

// ---------- geometría de cajas ----------

export const area = (b: Box) => b[2] * b[3];

export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const r = Math.min(a[0] + a[2], b[0] + b[2]);
  const btm = Math.min(a[1] + a[3], b[1] + b[3]);
  return r > x && btm > y ? [x, y, r - x, btm - y] : null;
}

export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b[0]));
  const y = Math.min(...boxes.map((b) => b[1]));
  const r = Math.max(...boxes.map((b) => b[0] + b[2]));
  const btm = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x, y, r - x, btm - y];
}

export function expand(b: Box, margin: number): Box {
  const dx = b[2] * margin;
  const dy = b[3] * margin;
  const x = Math.max(0, b[0] - dx);
  const y = Math.max(0, b[1] - dy);
  return [x, y, Math.min(1, b[0] + b[2] + dx) - x, Math.min(1, b[1] + b[3] + dy) - y];
}

/** Posición relativa legible de `inner` dentro de `outer`. */
export function describePlace(inner: Box, outer: Box): string {
  const rx = (inner[0] - outer[0]) / outer[2];
  const ry = (inner[1] - outer[1]) / outer[3];
  const rw = inner[2] / outer[2];
  const rh = inner[3] / outer[3];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `left ${pct(rx)}, top ${pct(ry)}, width ${pct(rw)}, height ${pct(rh)} of the composition`;
}

// ---------- recortes ----------

export interface CropOptions {
  margin?: number;
  masks?: Box[];
  maskColor?: string;
  mirror?: boolean;
}

export interface Crop {
  canvas: HTMLCanvasElement;
  /** Caja realmente recortada (normalizada). */
  box: Box;
  masked: boolean;
}

/** Recorte con margen del 15 %, lado mayor entre 768 y 1500 px y máscaras sobre objetos que tapan. */
export function cropBox(img: Img, target: Box, opt: CropOptions = {}): Crop {
  const box = expand(target, opt.margin ?? CROP.margin);
  const sx = box[0] * img.width;
  const sy = box[1] * img.height;
  const sw = Math.max(1, box[2] * img.width);
  const sh = Math.max(1, box[3] * img.height);
  const longest = Math.max(sw, sh);
  const k = Math.min(Math.max(longest, CROP.minSide), CROP.maxSide) / longest;
  const [c, ctx] = makeCanvas(sw * k, sh * k);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

  let masked = false;
  if (opt.masks?.length) {
    ctx.fillStyle = opt.maskColor ?? "#808080";
    for (const m of opt.masks) {
      const hit = intersect(m, box);
      if (!hit) continue;
      masked = true;
      ctx.fillRect(
        ((hit[0] - box[0]) / box[2]) * c.width,
        ((hit[1] - box[1]) / box[3]) * c.height,
        (hit[2] / box[2]) * c.width,
        (hit[3] / box[3]) * c.height,
      );
    }
  }
  return { canvas: opt.mirror ? mirror(c) : c, box, masked };
}

export function mirror(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(src.width, src.height);
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Une varias referencias a la misma altura en un lienzo horizontal. */
export function concatHorizontal(parts: HTMLCanvasElement[], height = 768, gap = 16, gapColor = "#808080"): HTMLCanvasElement {
  const widths = parts.map((p) => (p.width * height) / p.height);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
  const k = total > CROP.maxSide * 2 ? (CROP.maxSide * 2) / total : 1;
  const [c, ctx] = makeCanvas(total * k, height * k);
  ctx.fillStyle = gapColor;
  ctx.fillRect(0, 0, c.width, c.height);
  let x = 0;
  parts.forEach((p, i) => {
    ctx.drawImage(p, x * k, 0, widths[i] * k, height * k);
    x += widths[i] + gap;
  });
  return c;
}

/** Codifica una referencia por debajo de 8 MB: escalera de calidades JPEG y reducciones del 15 %. */
export async function encodeReference(src: HTMLCanvasElement, keepAlpha: boolean): Promise<Blob> {
  let c = src;
  for (let pass = 0; pass <= REFERENCE.maxShrinkPasses; pass++) {
    if (keepAlpha) {
      const png = await canvasToBlob(c, "image/png");
      if (png.size <= REFERENCE.targetBytes) return png;
    } else {
      for (const q of REFERENCE.jpegQualities) {
        const jpg = await canvasToBlob(c, "image/jpeg", q);
        if (jpg.size <= REFERENCE.targetBytes) return jpg;
      }
    }
    c = scaleToLongest(c, Math.max(c.width, c.height) * REFERENCE.shrinkFactor, true);
  }
  const last = await canvasToBlob(c, keepAlpha ? "image/png" : "image/jpeg", 0.6);
  if (last.size > REFERENCE.maxBytes) throw new ImageError("image_too_heavy", "La referencia es demasiado pesada.");
  return last;
}

/** Recorte "cover" a una proporción exacta (taza, wind banner). */
export function fitToRatio(img: Img, ratio: number): HTMLCanvasElement {
  const current = img.width / img.height;
  let sw = img.width;
  let sh = img.height;
  if (current > ratio) sw = img.height * ratio;
  else sh = img.width / ratio;
  const [c, ctx] = makeCanvas(sw, sh);
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, sw, sh);
  return c;
}

/** Fondo liso generado localmente, sin IA. */
export function solidPanel(color: string, ratio: number, longest = 2048): HTMLCanvasElement {
  const w = ratio >= 1 ? longest : longest * ratio;
  const h = ratio >= 1 ? longest / ratio : longest;
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function getImageData(img: Img): ImageData {
  const [, ctx] = makeCanvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

export function imageDataToCanvas(d: ImageData): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(d.width, d.height);
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function blobToCanvas(b: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(b);
  const [c, ctx] = makeCanvas(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export async function sha256(input: Blob | string): Promise<string> {
  const buf = typeof input === "string" ? new TextEncoder().encode(input) : await input.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
