// Transparencias: color clave, recuperación de bordes sin halo, restauración de alfa y recorte de bordes vacíos.
import { MATTE } from "./limits";

export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function hasAlpha(d: ImageData, threshold = 250): boolean {
  const p = d.data;
  for (let i = 3; i < p.length; i += 4) if (p[i] < threshold) return true;
  return false;
}

/** Mediana del color de los píxeles del borde. */
export function estimateBorderColor(d: ImageData): RGB {
  const { width: w, height: h, data: p } = d;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(p[i]);
    gs.push(p[i + 1]);
    bs.push(p[i + 2]);
  };
  for (let x = 0; x < w; x += step) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    push(0, y);
    push(w - 1, y);
  }
  const med = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Aplana el alfa contra el color clave (para proveedores que no aceptan transparencia). */
export function flattenOnKey(d: ImageData, key = hexToRgb(MATTE.color)): ImageData {
  const out = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  const p = out.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3] / 255;
    p[i] = p[i] * a + key[0] * (1 - a);
    p[i + 1] = p[i + 1] * a + key[1] * (1 - a);
    p[i + 2] = p[i + 2] * a + key[2] * (1 - a);
    p[i + 3] = 255;
  }
  return out;
}

/**
 * Quita el color clave estimándolo en el borde. Alfa suave por distancia de color
 * y "des-mezcla" del color clave en los píxeles semitransparentes para evitar halos.
 */
export function keyOut(d: ImageData, key?: RGB): ImageData {
  const k = key ?? estimateBorderColor(d);
  const out = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  const p = out.data;
  const lo = 0.1;
  const hi = lo + 0.12 + MATTE.slack;
  for (let i = 0; i < p.length; i += 4) {
    const dr = p[i] - k[0];
    const dg = p[i + 1] - k[1];
    const db = p[i + 2] - k[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;
    let a = dist <= lo ? 0 : dist >= hi ? 1 : (dist - lo) / (hi - lo);
    a *= p[i + 3] / 255;
    if (a > 0 && a < 1) {
      p[i] = clamp((p[i] - (1 - a) * k[0]) / a);
      p[i + 1] = clamp((p[i + 1] - (1 - a) * k[1]) / a);
      p[i + 2] = clamp((p[i + 2] - (1 - a) * k[2]) / a);
    }
    p[i + 3] = Math.round(a * 255);
  }
  return out;
}

/** Elimina el fondo conectado a los bordes (relleno por inundación). Alternativa local sin IA. */
export function removeBorderBackground(d: ImageData, tolerance = 0.16): ImageData {
  const { width: w, height: h } = d;
  const k = estimateBorderColor(d);
  const src = d.data;
  const out = new ImageData(new Uint8ClampedArray(src), w, h);
  const p = out.data;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const near = (idx: number) => {
    const i = idx * 4;
    const dr = src[i] - k[0];
    const dg = src[i + 1] - k[1];
    const db = src[i + 2] - k[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) / 441.7 < tolerance;
  };
  const seed = (idx: number) => {
    if (!seen[idx] && near(idx)) {
      seen[idx] = 1;
      stack[top++] = idx;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (top) {
    const idx = stack[--top];
    p[idx * 4 + 3] = 0;
    const x = idx % w;
    if (x > 0) seed(idx - 1);
    if (x < w - 1) seed(idx + 1);
    if (idx >= w) seed(idx - w);
    if (idx < w * (h - 1)) seed(idx + w);
  }
  // Borde suave de 1 px con des-mezcla del fondo.
  for (let idx = 0; idx < w * h; idx++) {
    if (seen[idx]) continue;
    const x = idx % w;
    const touches = (x > 0 && seen[idx - 1]) || (x < w - 1 && seen[idx + 1]) || (idx >= w && seen[idx - w]) || (idx < w * (h - 1) && seen[idx + w]);
    if (!touches) continue;
    const i = idx * 4;
    const a = 0.6;
    p[i] = clamp((p[i] - (1 - a) * k[0]) / a);
    p[i + 1] = clamp((p[i + 1] - (1 - a) * k[1]) / a);
    p[i + 2] = clamp((p[i + 2] - (1 - a) * k[2]) / a);
    p[i + 3] = Math.round(p[i + 3] * a);
  }
  return out;
}

export function extractAlpha(d: ImageData): { alpha: Uint8ClampedArray; width: number; height: number } {
  const alpha = new Uint8ClampedArray(d.width * d.height);
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = d.data[j];
  return { alpha, width: d.width, height: d.height };
}

/** Interpola un alfa original al tamaño de la respuesta y lo aplica (p. ej. tras ampliar). */
export function restoreAlpha(d: ImageData, src: { alpha: Uint8ClampedArray; width: number; height: number }): ImageData {
  const out = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  const p = out.data;
  const sx = (src.width - 1) / Math.max(1, d.width - 1);
  const sy = (src.height - 1) / Math.max(1, d.height - 1);
  for (let y = 0; y < d.height; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < d.width; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      const a =
        src.alpha[y0 * src.width + x0] * (1 - tx) * (1 - ty) +
        src.alpha[y0 * src.width + x1] * tx * (1 - ty) +
        src.alpha[y1 * src.width + x0] * (1 - tx) * ty +
        src.alpha[y1 * src.width + x1] * tx * ty;
      p[(y * d.width + x) * 4 + 3] = a;
    }
  }
  return out;
}

/** Recorta bordes vacíos (alfa por debajo del umbral) dejando un pequeño margen. */
export function trim(d: ImageData, threshold = MATTE.alphaThreshold, pad = 8): ImageData {
  const { width: w, height: h, data: p } = d;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (p[(y * w + x) * 4 + 3] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return d;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const nw = maxX - minX + 1;
  const nh = maxY - minY + 1;
  const out = new ImageData(nw, nh);
  for (let y = 0; y < nh; y++) {
    const s = ((minY + y) * w + minX) * 4;
    out.data.set(p.subarray(s, s + nw * 4), y * nw * 4);
  }
  return out;
}

/** Enfoque leve (máscara de desenfoque 3x3) usado por la ampliación local. */
export function sharpen(d: ImageData, amount = 0.35): ImageData {
  const { width: w, height: h, data: p } = d;
  const out = new ImageData(new Uint8ClampedArray(p), w, h);
  const o = out.data;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (p[i - 4 + c] + p[i + 4 + c] + p[i - w * 4 + c] + p[i + w * 4 + c]) / 4;
        o[i + c] = clamp(p[i + c] + (p[i + c] - blur) * amount * 2);
      }
    }
  }
  return out;
}

const clamp = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n);
