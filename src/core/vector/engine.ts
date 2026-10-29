// Motor de vectorizado propio: cuantiza a una paleta plana y traza cada color por separado.
// Las capas se apilan (cada capa cubre su color y todos los que van encima), así no quedan
// rendijas ni halos entre colores vecinos.
import { quantize, type Quantized } from "./quantize";
import { traceMask } from "./trace";

export interface VectorLayer {
  color: string;
  d: string;
}

export interface Traced {
  width: number;
  height: number;
  layers: VectorLayer[];
  /** Cantidad de subtrazados (para mostrar la complejidad). */
  paths: number;
}

export interface EngineOptions {
  /** 0 = más simple, 1 = máximo detalle. */
  detail: number;
  maxColors: number;
  hints?: string[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/** Parámetros de trazado según el detalle pedido y el tamaño de la imagen. */
export function traceParams(detail: number, w: number, h: number) {
  const scale = Math.max(w, h) / 1600;
  return {
    tolerance: lerp(2.8, 0.95, detail) * Math.max(1, scale),
    cornerAngle: lerp(128, 146, detail),
    // Área mínima baja: se conservan puntos y líneas finas; sólo se descarta ruido de 1–2 píxeles.
    minArea: Math.max(3, Math.round(lerp(60, 3, detail) * scale * scale)),
  };
}

export async function traceQuantized(q: Quantized, detail: number): Promise<Traced> {
  const { width: w, height: h, labels } = q;
  // Orden de apilado: de mayor a menor superficie (el fondo abajo, los detalles arriba).
  const order = q.palette.map((_, i) => i).filter((i) => q.areas[i] > 0).sort((a, b) => q.areas[b] - q.areas[a]);
  const rank = new Int16Array(q.palette.length).fill(-1);
  order.forEach((c, r) => (rank[c] = r));
  const params = traceParams(detail, w, h);
  const layers: VectorLayer[] = [];
  let paths = 0;
  const mask = new Uint8Array(w * h);
  for (let r = 0; r < order.length; r++) {
    for (let i = 0; i < labels.length; i++) mask[i] = labels[i] >= 0 && rank[labels[i]] >= r ? 1 : 0;
    const { d, count } = traceMask(mask, w, h, params);
    if (d) {
      layers.push({ color: q.palette[order[r]], d });
      paths += count;
    }
    await yieldUI();
  }
  return { width: w, height: h, layers, paths };
}

/** Imagen completa → vector (modo rápido, sin IA). */
export async function vectorizeImageData(d: ImageData, opt: EngineOptions): Promise<Traced> {
  const q = quantize(d, { maxColors: opt.maxColors, hints: opt.hints });
  return traceQuantized(q, opt.detail);
}

export const layersMarkup = (layers: VectorLayer[]) =>
  layers.map((l) => `<path fill="${l.color}" fill-rule="evenodd" d="${l.d}"/>`).join("");

/** SVG final. `scale` lleva las coordenadas trazadas al tamaño original de la imagen. */
export function tracedToSvg(t: Traced, outW: number, outH: number): string {
  const s = outW / t.width;
  const body = layersMarkup(t.layers);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(outW)} ${round(outH)}" width="${round(outW)}" height="${round(outH)}">${
    Math.abs(s - 1) < 1e-6 ? body : `<g transform="scale(${s.toFixed(6)})">${body}</g>`
  }</svg>`;
}

const round = (v: number) => Math.round(v * 100) / 100;
