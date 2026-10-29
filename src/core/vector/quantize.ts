// Cuantización de color para vectorizar: k-means en espacio Lab, ajuste a la paleta pedida y mapa de etiquetas.

export interface Quantized {
  width: number;
  height: number;
  /** Índice de color por píxel; -1 = transparente. */
  labels: Int16Array;
  /** Colores finales en hex (#rrggbb). */
  palette: string[];
  /** Píxeles de cada color. */
  areas: number[];
}

type Lab = [number, number, number];

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Lab → RGB aproximado (para el color promedio de cada grupo). */
function labToRgb([L, A, B]: Lab): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = A / 500 + fy;
  const fz = fy - B / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [X * 3.2406 - Y * 1.5372 - Z * 0.4986, -X * 0.9689 + Y * 1.8758 + Z * 0.0415, X * 0.0557 - Y * 0.204 + Z * 1.057];
  return lin.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, c * 255));
  }) as [number, number, number];
}

export interface QuantizeOptions {
  /** Máximo de colores. */
  maxColors: number;
  /** Colores esperados (de la IA): si un grupo cae cerca, toma el valor exacto. */
  hints?: string[];
  /** Alfa mínimo para considerar el píxel opaco. */
  alphaCut?: number;
  /**
   * Paleta estricta: sólo los colores de `hints`, ninguno más. Cada píxel va al color permitido
   * más cercano, así nunca aparecen colores que no van.
   */
  strict?: boolean;
  /**
   * Peso de la luminosidad al asignar cada píxel (1 = normal). Con menos peso, una zona sombreada
   * conserva su color (un blanco en sombra sigue siendo blanco y no pasa a un azul).
   */
  lightWeight?: number;
  /** Limpieza de textura/ruido con un filtro de mayoría 5×5 (imágenes con grano, telas, degradés). */
  denoise?: boolean;
}

/**
 * Reduce la imagen a una paleta plana.
 * La paleta sale de las zonas planas (píxeles rodeados por su mismo color): los bordes antialiasados
 * entre dos colores nunca generan colores intermedios falsos. Es determinista (mismo resultado siempre).
 * La asignación usa una caché por color de 15 bits: millones de píxeles cuestan como unos pocos miles.
 */
export function quantize(d: ImageData, opt: QuantizeOptions): Quantized {
  const { width: w, height: h, data: p } = d;
  const cut = opt.alphaCut ?? 128;
  const n = w * h;
  const hints = (opt.hints ?? []).map((x) => ({ hex: x.toLowerCase(), lab: rgbToLab(...hexToRgb(x)) }));

  // Clave de 15 bits por píxel (-1 = transparente).
  const key = new Int32Array(n);
  let opaqueCount = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (p[o + 3] < cut) key[i] = -1;
    else {
      key[i] = ((p[o] >> 3) << 10) | ((p[o + 1] >> 3) << 5) | (p[o + 2] >> 3);
      opaqueCount++;
    }
  }
  if (!opaqueCount) return { width: w, height: h, labels: new Int16Array(n).fill(-1), palette: [], areas: [] };

  const uniq = opt.strict && hints.length ? hints.filter((x, i) => hints.findIndex((y) => y.hex === x.hex) === i) : autoPalette();

  function autoPalette() {
  // Histograma de píxeles "planos": sus 8 vecinos tienen casi el mismo color (±1 nivel por canal).
  const near = (a: number, b: number) =>
    b >= 0 && Math.abs((a >> 10) - (b >> 10)) <= 1 && Math.abs(((a >> 5) & 31) - ((b >> 5) & 31)) <= 1 && Math.abs((a & 31) - (b & 31)) <= 1;
  const flatHist = new Uint32Array(32768);
  const allHist = new Uint32Array(32768);
  let flatCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = key[i];
      if (k < 0) continue;
      allHist[k]++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      if (near(k, key[i - 1]) && near(k, key[i + 1]) && near(k, key[i - w]) && near(k, key[i + w]) && near(k, key[i - w - 1]) && near(k, key[i - w + 1]) && near(k, key[i + w - 1]) && near(k, key[i + w + 1])) {
        flatHist[k]++;
        flatCount++;
      }
    }
  }
  // Fotos o degradés casi sin zonas planas: se usa el histograma completo.
  const hist = flatCount > opaqueCount * 0.05 ? flatHist : allHist;
  const histTotal = hist === flatHist ? flatCount : opaqueCount;

  // Agrupa los picos del histograma (ΔE < 10) de mayor a menor.
  const bins: number[] = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
  bins.sort((a, b) => hist[b] - hist[a]);
  const minCount = Math.max(12, histTotal * (opt.denoise ? 0.003 : 0.0002));
  const clusters: { lab: Lab; sum: Lab; count: number }[] = [];
  for (const k of bins) {
    const lab = rgbToLab(((k >> 10) << 3) | 4, (((k >> 5) & 31) << 3) | 4, ((k & 31) << 3) | 4);
    const c = hist[k];
    let best: (typeof clusters)[number] | null = null;
    let bd = opt.denoise ? 196 : 100;
    for (const cl of clusters) {
      const dd = dist2(cl.lab, lab);
      if (dd < bd) (bd = dd), (best = cl);
    }
    if (best) {
      best.sum[0] += lab[0] * c;
      best.sum[1] += lab[1] * c;
      best.sum[2] += lab[2] * c;
      best.count += c;
      best.lab = [best.sum[0] / best.count, best.sum[1] / best.count, best.sum[2] / best.count];
    } else if (c >= minCount) {
      clusters.push({ lab, sum: [lab[0] * c, lab[1] * c, lab[2] * c], count: c });
    }
  }
  clusters.sort((a, b) => b.count - a.count);
  const chosen = clusters.slice(0, Math.max(1, opt.maxColors));

  // Ajuste a la paleta exacta pedida (ΔE < 15) para conservar los colores de marca.
  const final = chosen.map((c) => {
    const hit = hints.reduce<{ hex: string; lab: Lab; d: number } | null>((b, x) => {
      const dd = dist2(x.lab, c.lab);
      return dd < 225 && (!b || dd < b.d) ? { ...x, d: dd } : b;
    }, null);
    return hit ? { hex: hit.hex, lab: hit.lab } : { hex: toHex(...labToRgb(c.lab)), lab: c.lab };
  });
  const out: typeof final = [];
  final.forEach((f) => !out.some((u) => u.hex === f.hex) && out.push(f));
  return out;
  }

  // Asignación de cada píxel al color más cercano (caché por clave de 15 bits).
  const wL = opt.lightWeight ?? 1;
  const cache = new Int16Array(32768).fill(-2);
  const labels = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const k = key[i];
    if (k < 0) {
      labels[i] = -1;
      continue;
    }
    let l = cache[k];
    if (l === -2) {
      const lab = rgbToLab(((k >> 10) << 3) | 4, (((k >> 5) & 31) << 3) | 4, ((k & 31) << 3) | 4);
      let bd = Infinity;
      l = 0;
      for (let c = 0; c < uniq.length; c++) {
        const u = uniq[c].lab;
        const dd = ((lab[0] - u[0]) * wL) ** 2 + (lab[1] - u[1]) ** 2 + (lab[2] - u[2]) ** 2;
        if (dd < bd) (bd = dd), (l = c);
      }
      cache[k] = l;
    }
    labels[i] = l;
  }
  modeFilter(labels, w, h);
  if (opt.strict) modeFilter(labels, w, h);
  if (opt.denoise) majority5(labels, w, h);
  const areas = new Array(uniq.length).fill(0);
  const sums = uniq.map(() => [0, 0, 0, 0]);
  // Por clave de color: ¿está cerca (ΔE < 8) del color de su grupo? Se calcula una sola vez por clave.
  const nearCache = new Int8Array(32768).fill(-1);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l < 0) continue;
    areas[l]++;
    // Sólo píxeles cercanos al color del grupo (los bordes antialiasados no lo ensucian).
    const k = key[i];
    if (cache[k] !== l) continue;
    if (nearCache[k] < 0) {
      const lab = rgbToLab(((k >> 10) << 3) | 4, (((k >> 5) & 31) << 3) | 4, ((k & 31) << 3) | 4);
      nearCache[k] = dist2(lab, uniq[l].lab) < 64 ? 1 : 0;
    }
    const o = i * 4;
    if (nearCache[k]) {
      const s = sums[l];
      s[0] += p[o];
      s[1] += p[o + 1];
      s[2] += p[o + 2];
      s[3]++;
    }
  }
  const palette = uniq.map((u, i) => (hints.some((x) => x.hex === u.hex) || !sums[i][3] ? u.hex : toHex(sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3])));
  return { width: w, height: h, labels, palette, areas };
}

/**
 * Filtro de moda 3×3: un píxel aislado (borde antialiasado que cayó en un tercer color) toma el color
 * mayoritario de sus vecinos. Mantiene esquinas y líneas finas de 2 px o más.
 */
function modeFilter(labels: Int16Array, w: number, h: number) {
  const src = labels.slice();
  const tally = new Map<number, number>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const me = src[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && src[i + dy * w + dx] === me) same++;
      if (same >= 2) continue;
      tally.clear();
      let best = me, bc = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = src[i + dy * w + dx];
          const c = (tally.get(v) ?? 0) + 1;
          tally.set(v, c);
          if (c > bc) (bc = c), (best = v);
        }
      labels[i] = best;
    }
  }
}

/**
 * Filtro de mayoría 5×5: elimina el grano y las motas de textura sin redondear los bordes reales
 * (un píxel sólo cambia si su color es minoría clara en la ventana y otro es mayoría).
 */
function majority5(labels: Int16Array, w: number, h: number) {
  const src = labels.slice();
  const counts = new Map<number, number>();
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const me = src[i];
      counts.clear();
      for (let dy = -2; dy <= 2; dy++) {
        const row = i + dy * w;
        for (let dx = -2; dx <= 2; dx++) {
          const v = src[row + dx];
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      if ((counts.get(me) ?? 0) >= 8) continue;
      let best = me, bc = 0;
      counts.forEach((c, v) => c > bc && ((bc = c), (best = v)));
      if (bc >= 13) labels[i] = best;
    }
  }
}
