// Mini motor 3D en WebGL2 (sin librerías): mallas procedurales de productos, luz suave y cámara orbital.

export type ProductKind = "camiseta" | "taza" | "banner" | "wind";

export interface Part {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** "print" usa la textura del producto; "plain" sólo el color base. */
  material: "print" | "plain";
  color?: [number, number, number];
}

// ---------- matemática mínima ----------

type M4 = Float32Array;
const m4 = () => new Float32Array(16);

function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  const o = m4();
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function lookAt(eye: number[], target: number[], up: number[]): M4 {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const o = m4();
  o.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return o;
}

function mul(a: M4, b: M4): M4 {
  const o = m4();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---------- construcción de mallas ----------

class Builder {
  p: number[] = [];
  n: number[] = [];
  t: number[] = [];
  i: number[] = [];
  vertex(x: number, y: number, z: number, u: number, v: number) {
    this.p.push(x, y, z);
    this.n.push(0, 0, 0);
    this.t.push(u, v);
    return this.p.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.i.push(a, b, c);
  }
  /** Normales suaves por acumulación de caras. */
  build(material: Part["material"], color?: Part["color"]): Part {
    const { p, n, i } = this;
    for (let k = 0; k < i.length; k += 3) {
      const [a, b, c] = [i[k] * 3, i[k + 1] * 3, i[k + 2] * 3];
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const f = cross(e1, e2);
      for (const v of [a, b, c]) {
        n[v] += f[0];
        n[v + 1] += f[1];
        n[v + 2] += f[2];
      }
    }
    for (let k = 0; k < n.length; k += 3) {
      const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
      n[k] /= l;
      n[k + 1] /= l;
      n[k + 2] /= l;
    }
    return { positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(this.t), indices: new Uint32Array(i), material, color };
  }
}

/** Silueta frontal de una camiseta (sentido horario), en unidades de modelo. */
export const SHIRT_OUTLINE: [number, number][] = [
  [-0.27, 1.13], [-0.6, 1.05], [-0.9, 0.93], [-1.12, 0.66], [-1.2, 0.44], [-0.96, 0.24], [-0.66, 0.5],
  [-0.63, 0.1], [-0.65, -0.6], [-0.67, -1.12], [-0.35, -1.15], [0, -1.16], [0.35, -1.15], [0.67, -1.12],
  [0.65, -0.6], [0.63, 0.1], [0.66, 0.5], [0.96, 0.24], [1.2, 0.44], [1.12, 0.66], [0.9, 0.93], [0.6, 1.05],
  [0.27, 1.13], [0.2, 1.04], [0.1, 0.985], [0, 0.97], [-0.1, 0.985], [-0.2, 1.04],
];

/** Zona del torso en la textura de cada cara (para ubicar la estampa). */
export const SHIRT_BOUNDS = { minX: -1.24, maxX: 1.24, minY: -1.18, maxY: 1.16 };

function inside(x: number, y: number, poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function nearestOnPoly(x: number, y: number, poly: [number, number][]): { x: number; y: number; d: number } {
  let best = { x, y, d: Infinity };
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { x: px, y: py, d };
  }
  return best;
}

/**
 * Camiseta procedural: grilla dentro de la silueta, con espesor según la distancia al borde
 * (cuerpo "inflado"). Frente y espalda comparten los vértices del borde, así la prenda queda cerrada.
 * UV: frente en la mitad izquierda de la textura y espalda (espejada) en la derecha.
 */
function shirt(): Part[] {
  const { minX, maxX, minY, maxY } = SHIRT_BOUNDS;
  const NX = 120, NY = 118;
  const R = 0.42, T = 0.26;
  const grid: { x: number; y: number; z: number; ok: boolean }[] = [];
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const x = minX + ((maxX - minX) * i) / NX;
      const y = minY + ((maxY - minY) * j) / NY;
      const inn = inside(x, y, SHIRT_OUTLINE);
      const near = nearestOnPoly(x, y, SHIRT_OUTLINE);
      const k = Math.min(near.d / R, 1);
      // Cuerpo inflado + leve ondulación de tela (más marcada hacia los costados y el ruedo).
      const body = T * (1 - (1 - k) * (1 - k)) * (0.75 + 0.25 * Math.cos(x * 1.1));
      const cloth = 1 + 0.035 * Math.sin(x * 9 + y * 4) * Math.sin(y * 6) * (0.4 + Math.abs(x));
      grid.push({ x, y, z: inn ? body * cloth : 0, ok: inn });
    }
  // Vértices de afuera pegados a la silueta: se proyectan sobre el borde (z = 0) para un contorno limpio.
  const at = (i: number, j: number) => grid[j * (NX + 1) + i];
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const g = at(i, j);
      if (g.ok) continue;
      let touches = false;
      for (let dj = -1; dj <= 1 && !touches; dj++)
        for (let di = -1; di <= 1; di++) {
          const n = at(Math.min(NX, Math.max(0, i + di)), Math.min(NY, Math.max(0, j + dj)));
          if (n.ok) touches = true;
        }
      if (touches) {
        const p = nearestOnPoly(g.x, g.y, SHIRT_OUTLINE);
        Object.assign(g, { x: p.x, y: p.y, z: 0, ok: true, edge: true });
      }
    }
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    const b = new Builder();
    const idx = new Map<number, number>();
    const vid = (i: number, j: number) => {
      const key = j * (NX + 1) + i;
      let v = idx.get(key);
      if (v === undefined) {
        const g = grid[key];
        const u = (g.x - minX) / (maxX - minX);
        const vv = 1 - (g.y - minY) / (maxY - minY);
        v = b.vertex(g.x, g.y, g.z * side, side > 0 ? u * 0.5 : 0.5 + (1 - u) * 0.5, vv);
        idx.set(key, v);
      }
      return v;
    };
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const a = at(i, j), c = at(i + 1, j), d = at(i + 1, j + 1), e = at(i, j + 1);
        if (!(a.ok && c.ok && d.ok && e.ok)) continue;
        const [va, vc, vd, ve] = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)];
        if (side > 0) {
          b.tri(va, vc, vd);
          b.tri(va, vd, ve);
        } else {
          b.tri(va, vd, vc);
          b.tri(va, ve, vd);
        }
      }
    parts.push(b.build("print"));
  }
  return parts;
}

/** Taza: cuerpo con la estampa envolvente (costura detrás del asa), borde, interior, base y asa. */
function mug(): Part[] {
  const r = 0.82, ri = 0.75, h = 1.0, seg = 128;
  const body = new Builder();
  for (let j = 0; j <= 1; j++)
    for (let s = 0; s <= seg; s++) {
      const u = s / seg;
      // u = 0.5 queda al frente (+z); la costura (u = 0 / 1) queda atrás.
      const th = u * Math.PI * 2 - Math.PI;
      body.vertex(r * Math.sin(th), j ? h : -h, r * Math.cos(th), u, j ? 0 : 1);
    }
  for (let s = 0; s < seg; s++) {
    const a = s, b = s + 1, c = seg + 1 + s + 1, d = seg + 1 + s;
    body.tri(a, b, c);
    body.tri(a, c, d);
  }
  const plain = new Builder();
  const ring = (rad: number, y: number) => {
    const start = plain.p.length / 3;
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      plain.vertex(rad * Math.sin(th), y, rad * Math.cos(th), 0, 0);
    }
    return start;
  };
  const strip = (a0: number, b0: number, flip = false) => {
    for (let s = 0; s < seg; s++) {
      const a = a0 + s, b = a0 + s + 1, c = b0 + s + 1, d = b0 + s;
      if (flip) {
        plain.tri(a, c, b);
        plain.tri(a, d, c);
      } else {
        plain.tri(a, b, c);
        plain.tri(a, c, d);
      }
    }
  };
  const outerTop = ring(r, h), innerTop = ring(ri, h), innerBottom = ring(ri, -h + 0.12);
  strip(outerTop, innerTop); // borde superior
  strip(innerTop, innerBottom, false); // pared interior
  const center = plain.vertex(0, -h + 0.12, 0, 0, 0);
  for (let s = 0; s < seg; s++) plain.tri(center, innerBottom + s, innerBottom + s + 1);
  const outerBottom = ring(r, -h);
  const c2 = plain.vertex(0, -h, 0, 0, 0);
  for (let s = 0; s < seg; s++) plain.tri(c2, outerBottom + s + 1, outerBottom + s);

  // Asa: tubo que sigue media elipse sobre el lado +x.
  const handle = new Builder();
  const steps = 48, around = 20, tube = 0.085, ax = 0.42, ay = 0.56;
  for (let k = 0; k <= steps; k++) {
    const t = -Math.PI / 2 + (k / steps) * Math.PI;
    const P = [r - 0.04 + ax * Math.cos(t), ay * Math.sin(t), 0];
    const T = norm([-ax * Math.sin(t), ay * Math.cos(t), 0]);
    const B = [0, 0, 1];
    const N = cross(B, T);
    for (let a = 0; a <= around; a++) {
      const ph = (a / around) * Math.PI * 2;
      handle.vertex(P[0] + (N[0] * Math.cos(ph) + B[0] * Math.sin(ph)) * tube, P[1] + (N[1] * Math.cos(ph)) * tube, P[2] + Math.sin(ph) * tube, 0, 0);
    }
  }
  for (let k = 0; k < steps; k++)
    for (let a = 0; a < around; a++) {
      const i0 = k * (around + 1) + a, i1 = i0 + 1, i2 = i0 + around + 2, i3 = i0 + around + 1;
      handle.tri(i0, i2, i1);
      handle.tri(i0, i3, i2);
    }
  return [body.build("print"), plain.build("plain"), handle.build("plain")];
}

/** Banner horizontal 3:1 con una ondulación suave. */
function banner(): Part[] {
  const b = new Builder();
  const NX = 90, NY = 30, W = 3, H = 1;
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NY;
      const x = (u - 0.5) * W, y = (0.5 - v) * H;
      b.vertex(x, y, 0.06 * Math.sin(u * Math.PI * 2.5), u, v);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      b.tri(a, a + NX + 2, a + 1);
      b.tri(a, a + NX + 1, a + NX + 2);
    }
  return [b.build("print")];
}

/** Wind banner (bandera pluma) con su mástil. */
function windBanner(): Part[] {
  const b = new Builder();
  const NX = 40, NY = 100, W = 1, H = 2.5;
  const top = (x: number) => H - 0.55 * x * x;
  const bottom = (x: number) => 0.25 * x;
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NY;
      const x = u * W;
      const y = top(x) + (bottom(x) - top(x)) * v;
      b.vertex(x - 0.5, y - H / 2, 0.09 * Math.sin(u * Math.PI) * (0.6 + 0.4 * v), u, v);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      b.tri(a, a + NX + 2, a + 1);
      b.tri(a, a + NX + 1, a + NX + 2);
    }
  const pole = new Builder();
  const seg = 16, rad = 0.025;
  for (let j = 0; j <= 1; j++)
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      pole.vertex(-0.5 - rad + rad * Math.cos(th), j ? H / 2 + 0.05 : -H / 2 - 0.55, rad * Math.sin(th), 0, 0);
    }
  for (let s = 0; s < seg; s++) {
    pole.tri(s, seg + 1 + s + 1, s + 1);
    pole.tri(s, seg + 1 + s, seg + 1 + s + 1);
  }
  return [b.build("print"), pole.build("plain", [0.18, 0.18, 0.2])];
}

export const MESHES: Record<ProductKind, () => Part[]> = { camiseta: shirt, taza: mug, banner, wind: windBanner };

// ---------- render ----------

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv;
uniform mat4 uMVP; uniform mat4 uModel;
out vec3 vNrm; out vec2 vUv; out vec3 vPos;
void main(){ vNrm = mat3(uModel) * aNrm; vUv = aUv; vPos = (uModel * vec4(aPos,1.)).xyz; gl_Position = uMVP * vec4(aPos,1.); }`;

const FS = `#version 300 es
precision highp float;
in vec3 vNrm; in vec2 vUv; in vec3 vPos;
uniform sampler2D uTex; uniform vec3 uBase; uniform float uUseTex; uniform vec3 uEye; uniform float uFabric;
out vec4 o;
void main(){
  vec3 n = normalize(vNrm); if(!gl_FrontFacing) n = -n;
  vec3 base = uBase;
  if(uUseTex > .5){ vec4 t = texture(uTex, vUv); base = mix(uBase, t.rgb, t.a); }
  vec3 v = normalize(uEye - vPos);
  vec3 key = normalize(vec3(.55,.8,.9)), fill = normalize(vec3(-.7,.25,.4)), back = normalize(vec3(0.,.3,-1.));
  float d = max(dot(n,key),0.)*.62 + max(dot(n,fill),0.)*.22 + max(dot(n,back),0.)*.16;
  float rim = pow(1. - max(dot(n,v),0.), 3.) * .12;
  float spec = pow(max(dot(reflect(-key,n), v),0.), 24.) * (1. - uFabric) * .35;
  float weave = uFabric * (sin(vUv.x*2600.)*sin(vUv.y*2600.)) * .015;
  vec3 c = base * (.24 + d * .9) + rim + spec + weave;
  c = c / (1. + c * .18);
  o = vec4(pow(c, vec3(1./1.12)), 1.);
}`;

interface GpuPart {
  vao: WebGLVertexArrayObject;
  count: number;
  part: Part;
}

export class Viewer {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
  parts: GpuPart[] = [];
  yaw = 0.35;
  pitch = 0.12;
  dist = 4.4;
  base: [number, number, number] = [0.95, 0.95, 0.95];
  fabric = 1;
  bg: [number, number, number, number] = [0, 0, 0, 0];
  private raf = 0;
  private dirty = true;
  auto = false;
  onFrame?: () => void;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: true });
    if (!gl) throw new Error("Tu navegador no soporta WebGL2.");
    this.gl = gl;
    this.prog = this.program(VS, FS);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 0]));
    gl.enable(gl.DEPTH_TEST);
    const loop = () => {
      if (this.auto) {
        this.yaw += 0.006;
        this.dirty = true;
      }
      // Oculto (otra herramienta en pantalla): no se dibuja, pero conserva todo su estado.
      if (this.dirty && this.canvas.clientWidth > 0) this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private program(vs: string, fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
    return p;
  }

  setParts(parts: Part[]) {
    const gl = this.gl;
    for (const g of this.parts) gl.deleteVertexArray(g.vao);
    this.parts = parts.map((part) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const attr = (name: string, data: Float32Array, size: number) => {
        const loc = gl.getAttribLocation(this.prog, name);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      attr("aPos", part.positions, 3);
      attr("aNrm", part.normals, 3);
      attr("aUv", part.uvs, 2);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: part.indices.length, part };
    });
    this.dirty = true;
  }

  setTexture(src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  /** Ajusta el buffer al tamaño visible (o a uno fijo para foto/video). */
  resize(w?: number, h?: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = w ?? Math.round(this.canvas.clientWidth * dpr);
    const height = h ?? Math.round(this.canvas.clientHeight * dpr);
    if (width && height && (this.canvas.width !== width || this.canvas.height !== height)) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.dirty = true;
  }

  draw() {
    const gl = this.gl;
    this.dirty = false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.bg);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const eye = [this.dist * Math.sin(this.yaw) * Math.cos(this.pitch), this.dist * Math.sin(this.pitch), this.dist * Math.cos(this.yaw) * Math.cos(this.pitch)];
    const proj = perspective(0.62, this.canvas.width / Math.max(1, this.canvas.height), 0.1, 50);
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const model = m4();
    model.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const mvp = mul(proj, view);
    gl.useProgram(this.prog);
    const u = (n: string) => gl.getUniformLocation(this.prog, n);
    gl.uniformMatrix4fv(u("uMVP"), false, mvp);
    gl.uniformMatrix4fv(u("uModel"), false, model);
    gl.uniform3fv(u("uEye"), eye);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u("uTex"), 0);
    for (const g of this.parts) {
      const plain = g.part.material === "plain";
      gl.uniform3fv(u("uBase"), plain && g.part.color ? g.part.color : this.base);
      gl.uniform1f(u("uUseTex"), plain ? 0 : 1);
      gl.uniform1f(u("uFabric"), plain ? 0 : this.fabric);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    this.onFrame?.();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
