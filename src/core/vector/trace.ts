// Trazador de máscaras binarias → trazados SVG limpios.
// 1) limpia motas y agujeritos, 2) sigue el contorno exacto sobre la grilla de píxeles,
// 3) detecta esquinas reales (quedan filosas), 4) suaviza sólo los tramos curvos y
// 5) ajusta curvas Bézier cúbicas (Schneider, "Graphics Gems"); los tramos rectos salen como rectas.

export interface TraceOptions {
  /** Error máximo del ajuste de curvas, en píxeles (menor = más fiel, más nodos). */
  tolerance: number;
  /** Ángulo (grados) por debajo del cual un vértice es esquina. */
  cornerAngle: number;
  /** Área mínima (px) de una forma o un agujero: lo menor se considera ruido. */
  minArea: number;
}

interface P {
  x: number;
  y: number;
}

// ---------- limpieza ----------

/** Elimina formas y agujeros más chicos que `minArea` (componentes 4-conexas). */
export function despeckle(mask: Uint8Array, w: number, h: number, minArea: number) {
  if (minArea <= 1) return;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const comp: number[] = [];
  for (const target of [1, 0]) {
    seen.fill(0);
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || mask[start] !== target) continue;
      let top = 0;
      let touchesBorder = false;
      comp.length = 0;
      stack[top++] = start;
      seen[start] = 1;
      while (top) {
        const i = stack[--top];
        comp.push(i);
        const x = i % w;
        const y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
        if (x > 0 && !seen[i - 1] && mask[i - 1] === target) (seen[i - 1] = 1), (stack[top++] = i - 1);
        if (x < w - 1 && !seen[i + 1] && mask[i + 1] === target) (seen[i + 1] = 1), (stack[top++] = i + 1);
        if (y > 0 && !seen[i - w] && mask[i - w] === target) (seen[i - w] = 1), (stack[top++] = i - w);
        if (y < h - 1 && !seen[i + w] && mask[i + w] === target) (seen[i + w] = 1), (stack[top++] = i + w);
      }
      // Formas chicas → se borran; agujeros chicos (no conectados al exterior) → se rellenan.
      if (comp.length < minArea && (target === 1 || !touchesBorder)) for (const i of comp) mask[i] = target ? 0 : 1;
    }
  }
}

// ---------- contornos ----------

/**
 * Sigue los bordes entre píxeles dentro/fuera. Cada lado expuesto de un píxel es una arista en sentido
 * horario; al unirlas salen lazos cerrados (contornos exteriores horarios, agujeros antihorarios).
 */
export function contours(mask: Uint8Array, w: number, h: number): P[][] {
  const W1 = w + 1;
  const V = W1 * (h + 1);
  const out1 = new Int32Array(V).fill(-1);
  const out2 = new Int32Array(V).fill(-1);
  const cap = 4 * w * h + 4;
  const eFrom = new Int32Array(cap);
  const eTo = new Int32Array(cap);
  const eDir = new Uint8Array(cap);
  let count = 0;
  const add = (a: number, b: number, dir: number) => {
    eFrom[count] = a;
    eTo[count] = b;
    eDir[count] = dir;
    if (out1[a] < 0) out1[a] = count;
    else out2[a] = count;
    count++;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const tl = y * W1 + x, tr = tl + 1, bl = tl + W1, br = bl + 1;
      if (y === 0 || !mask[(y - 1) * w + x]) add(tl, tr, 0);
      if (x === w - 1 || !mask[y * w + x + 1]) add(tr, br, 1);
      if (y === h - 1 || !mask[(y + 1) * w + x]) add(br, bl, 2);
      if (x === 0 || !mask[y * w + x - 1]) add(bl, tl, 3);
    }
  }
  const used = new Uint8Array(count);
  const loops: P[][] = [];
  for (let s = 0; s < count; s++) {
    if (used[s]) continue;
    const loop: P[] = [];
    let e = s;
    while (e >= 0 && !used[e]) {
      used[e] = 1;
      const a = eFrom[e], b = eTo[e];
      // Punto medio de cada arista: elimina el escalonado de 1 px antes de ajustar curvas.
      loop.push({ x: ((a % W1) + (b % W1)) / 2, y: (Math.floor(a / W1) + Math.floor(b / W1)) / 2 });
      const c1 = out1[b], c2 = out2[b];
      const free1 = c1 >= 0 && !used[c1];
      const free2 = c2 >= 0 && !used[c2];
      if (free1 && free2) {
        // Vértice en silla (dos píxeles en diagonal): se dobla siempre hacia la derecha.
        e = eDir[c1] === (eDir[e] + 1) % 4 ? c1 : c2;
      } else e = free1 ? c1 : free2 ? c2 : -1;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// ---------- geometría ----------

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const len = (a: P) => Math.hypot(a.x, a.y);
const norm = (a: P): P => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};

/** Esquinas: ángulo pronunciado medido a k puntos de distancia y máximo local. */
function findCorners(p: P[], cornerAngle: number): number[] {
  const n = p.length;
  const k = n < 24 ? 2 : n < 80 ? 3 : 4;
  const k2 = Math.min(Math.floor(n / 4), k * 2);
  const limit = Math.cos((cornerAngle * Math.PI) / 180);
  const limit2 = Math.cos(((cornerAngle + 12) * Math.PI) / 180);
  const cosAt = (i: number, kk: number) => {
    const a = sub(p[(i - kk + n) % n], p[i]);
    const b = sub(p[(i + kk) % n], p[i]);
    return dot(a, b) / (len(a) * len(b) || 1);
  };
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = cosAt(i, k);
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (c[i] <= limit || cosAt(i, k2) <= limit2) continue;
    let isMax = true;
    for (let j = -k; j <= k && isMax; j++) {
      if (!j) continue;
      const o = c[(i + j + n) % n];
      if (o > c[i] || (o === c[i] && j < 0)) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  return corners;
}

/** Ubica la esquina en el cruce de las dos rectas que llegan a ella (esquina nítida, no achaflanada). */
function sharpenCorner(p: P[], i: number, m: number): P {
  const n = p.length;
  const a0 = p[(i - m + n) % n], a1 = p[(i - 1 + n) % n];
  const b0 = p[(i + 1) % n], b1 = p[(i + m) % n];
  const da = sub(a1, a0), db = sub(b1, b0);
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-6) return p[i];
  const t = ((b0.x - a0.x) * db.y - (b0.y - a0.y) * db.x) / den;
  const q = add(a0, mul(da, t));
  return len(sub(q, p[i])) < 1.6 ? q : p[i];
}

// ---------- ajuste de curvas (Schneider) ----------

type Bez = [P, P, P, P];

const bez = (b: Bez, t: number): P => {
  const u = 1 - t;
  return {
    x: b[0].x * u * u * u + 3 * b[1].x * u * u * t + 3 * b[2].x * u * t * t + b[3].x * t * t * t,
    y: b[0].y * u * u * u + 3 * b[1].y * u * u * t + 3 * b[2].y * u * t * t + b[3].y * t * t * t,
  };
};

function chordParams(d: P[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(d[i], d[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(d: P[], first: number, last: number, u: number[], t1: P, t2: P): Bez {
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  const p0 = d[first], p3 = d[last];
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = len(sub(p3, p0));
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  if (al < 1e-6 * seg || ar < 1e-6 * seg || !Number.isFinite(al) || !Number.isFinite(ar)) al = ar = seg / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(d: P[], first: number, last: number, b: Bez, u: number[]): [number, number] {
  let max = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const q = bez(b, u[i - first]);
    const e = (q.x - d[i].x) ** 2 + (q.y - d[i].y) ** 2;
    if (e >= max) (max = e), (split = i);
  }
  return [max, split];
}

function reparameterize(d: P[], first: number, b: Bez, u: number[]): number[] {
  const d1: P[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)];
  const d2: P[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  return u.map((t, i) => {
    const p = d[first + i];
    const q = sub(bez(b, t), p);
    const mt = 1 - t;
    const q1 = add(add(mul(d1[0], mt * mt), mul(d1[1], 2 * mt * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], mt), mul(d2[1], t));
    const den = dot(q1, q1) + dot(q, q2);
    const next = den !== 0 ? t - dot(q, q1) / den : t;
    return Math.min(1, Math.max(0, next));
  });
}

function fitCubic(d: P[], first: number, last: number, t1: P, t2: P, err: number, out: Bez[], depth = 0) {
  if (last - first === 1 || depth > 24) {
    const dist = len(sub(d[last], d[first])) / 3;
    out.push([d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]]);
    return;
  }
  let u = chordParams(d, first, last);
  let b = generateBezier(d, first, last, u, t1, t2);
  let [e, split] = maxError(d, first, last, b, u);
  if (e < err) return void out.push(b);
  if (e < err * 4) {
    for (let it = 0; it < 6; it++) {
      u = reparameterize(d, first, b, u);
      b = generateBezier(d, first, last, u, t1, t2);
      [e, split] = maxError(d, first, last, b, u);
      if (e < err) return void out.push(b);
    }
  }
  if (split <= first) split = first + 1;
  if (split >= last) split = last - 1;
  const center = norm(sub(d[split - 1], d[split + 1]));
  fitCubic(d, first, split, t1, center, err, out, depth + 1);
  fitCubic(d, split, last, mul(center, -1), t2, err, out, depth + 1);
}

/** Distancia de un punto a la recta a–b. */
const lineDist = (p: P, a: P, b: P) => {
  const ab = sub(b, a);
  const l = len(ab);
  return l < 1e-9 ? len(sub(p, a)) : Math.abs(ab.x * (a.y - p.y) - ab.y * (a.x - p.x)) / l;
};

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Un lazo de contorno → subtrazado SVG con curvas suaves y esquinas nítidas. */
function fitLoop(raw: P[], opt: TraceOptions): string {
  const n = raw.length;
  if (n < 8) return `M${raw.map((p) => `${f2(p.x)} ${f2(p.y)}`).join("L")}Z`;
  const corners = findCorners(raw, opt.cornerAngle);
  const isCorner = new Uint8Array(n);
  corners.forEach((i) => (isCorner[i] = 1));

  // Suavizado (dos pasadas) que no toca las esquinas ni sus vecinos inmediatos.
  let p = raw.map((q) => ({ ...q }));
  const nearCorner = new Uint8Array(n);
  corners.forEach((c) => {
    for (let j = -2; j <= 2; j++) nearCorner[(c + j + n) % n] = 1;
  });
  for (let pass = 0; pass < 4; pass++) {
    const q = p.map((v) => ({ ...v }));
    for (let i = 0; i < n; i++) {
      if (nearCorner[i]) continue;
      const a = p[(i - 1 + n) % n], c = p[(i + 1) % n];
      q[i] = { x: (a.x + 2 * p[i].x + c.x) / 4, y: (a.y + 2 * p[i].y + c.y) / 4 };
    }
    p = q;
  }
  corners.forEach((i) => (p[i] = sharpenCorner(raw, i, Math.min(6, Math.max(2, Math.floor(n / 16))))));

  // Cortes: las esquinas; si no hay, dos cortes suaves (tangente compartida) para cerrar la forma.
  const cuts = corners.length ? corners : [0, Math.floor(n / 2)];
  const smooth = !corners.length;
  const err = opt.tolerance * opt.tolerance;
  const out: Bez[] = [];
  for (let c = 0; c < cuts.length; c++) {
    const a = cuts[c];
    const bIdx = cuts[(c + 1) % cuts.length];
    const segLen = ((bIdx - a + n) % n || n) + 1;
    const seg: P[] = [];
    for (let i = 0; i < segLen; i++) seg.push(p[(a + i) % n]);
    if (seg.length < 2) continue;
    if (!smooth) {
      const a0 = seg[0], a1 = seg[seg.length - 1];
      let dev = 0;
      for (const q of seg) dev = Math.max(dev, lineDist(q, a0, a1));
      if (dev <= Math.max(0.8, opt.tolerance * 0.45)) {
        out.push([a0, a0, a1, a1]);
        continue;
      }
    }
    const look = Math.min(3, seg.length - 1);
    const t1 = smooth ? norm(sub(p[(a + 1) % n], p[(a - 1 + n) % n])) : norm(sub(seg[look], seg[0]));
    const t2 = smooth ? norm(sub(p[(bIdx - 1 + n) % n], p[(bIdx + 1) % n])) : norm(sub(seg[seg.length - 1 - look], seg[seg.length - 1]));
    fitCubic(seg, 0, seg.length - 1, t1, t2, err, out);
  }
  if (!out.length) return "";
  let d = `M${f2(out[0][0].x)} ${f2(out[0][0].y)}`;
  for (const b of out) {
    // Curva casi recta → recta pura (bordes de letras y formas geométricas impecables).
    const straight = (b[1] === b[0] && b[2] === b[3]) || (lineDist(b[1], b[0], b[3]) < 0.04 && lineDist(b[2], b[0], b[3]) < 0.04);
    if (straight) d += `L${f2(b[3].x)} ${f2(b[3].y)}`;
    else d += `C${f2(b[1].x)} ${f2(b[1].y)} ${f2(b[2].x)} ${f2(b[2].y)} ${f2(b[3].x)} ${f2(b[3].y)}`;
  }
  return `${d}Z`;
}

/** Máscara binaria → atributo `d` (subtrazados con regla evenodd para los agujeros). */
export function traceMask(mask: Uint8Array, w: number, h: number, opt: TraceOptions): { d: string; count: number } {
  despeckle(mask, w, h, opt.minArea);
  const loops = contours(mask, w, h);
  const parts = loops.map((l) => fitLoop(l, opt)).filter(Boolean);
  return { d: parts.join(""), count: parts.length };
}
