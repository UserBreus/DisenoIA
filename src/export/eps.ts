// Conversión SVG → EPS (RGB). Cubre lo que generan los vectorizadores: path, rect, polygon, circle, ellipse, g y transform.

type M = [number, number, number, number, number, number];

const NAMED: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255] };

function parseColor(v: string | null): [number, number, number] | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  const rgb = /^rgba?\(([^)]+)\)/.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,]+/).map(parseFloat);
    if (parts.length > 3 && parts[3] === 0) return null;
    return [parts[0], parts[1], parts[2]];
  }
  return NAMED[s] ?? null;
}

function styleProp(el: Element, name: string): string | null {
  const style = el.getAttribute("style");
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1].trim();
  }
  return el.getAttribute(name);
}

function parseTransform(t: string | null): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    let n: M;
    switch (r[1]) {
      case "matrix":
        n = a as M;
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case "rotate": {
        const rad = ((a[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        n = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = mul(m, n);
  }
  return m;
}

const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function pathToPs(d: string): string {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0;
  let lcx = 0, lcy = 0, lqx = 0, lqy = 0;
  let prev = "";
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case "M":
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        out.push(`${f(x)} ${f(y)} m`);
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = ox + num();
        y = oy + num();
        out.push(`${f(x)} ${f(y)} l`);
        break;
      case "H":
        x = ox + num();
        out.push(`${f(x)} ${f(y)} l`);
        break;
      case "V":
        y = oy + num();
        out.push(`${f(x)} ${f(y)} l`);
        break;
      case "C": {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} c`);
        lcx = x2;
        lcy = y2;
        break;
      }
      case "S": {
        const x1 = /[CS]/.test(prev) ? 2 * x - lcx : x;
        const y1 = /[CS]/.test(prev) ? 2 * y - lcy : y;
        const x2 = ox + num(), y2 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} c`);
        lcx = x2;
        lcy = y2;
        break;
      }
      case "Q":
      case "T": {
        let qx: number, qy: number;
        if (C === "Q") {
          qx = ox + num();
          qy = oy + num();
        } else {
          qx = /[QT]/.test(prev) ? 2 * x - lqx : x;
          qy = /[QT]/.test(prev) ? 2 * y - lqy : y;
        }
        const nx = ox + num(), ny = oy + num();
        out.push(`${f(x + (2 / 3) * (qx - x))} ${f(y + (2 / 3) * (qy - y))} ${f(nx + (2 / 3) * (qx - nx))} ${f(ny + (2 / 3) * (qy - ny))} ${f(nx)} ${f(ny)} c`);
        lqx = qx;
        lqy = qy;
        x = nx;
        y = ny;
        break;
      }
      case "A":
        // Arcos: se aproximan con una recta al punto final (poco frecuentes en vectorizados).
        num(); num(); num(); num(); num();
        x = ox + num();
        y = oy + num();
        out.push(`${f(x)} ${f(y)} l`);
        break;
      case "Z":
        out.push("h");
        x = sx;
        y = sy;
        break;
      default:
        i++;
    }
    prev = C;
    if (C === "Z" && isNum()) cmd = "L";
  }
  return out.join(" ");
}

function ellipsePs(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  return [
    `${f(cx + rx)} ${f(cy)} m`,
    `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
    `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
    `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
    `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c h`,
  ].join(" ");
}

type Entry = { push: M } | { pop: true } | { rgb: [number, number, number]; geom: string; evenodd: boolean };

/** Recorre el SVG y lo baja a una lista neutra de rellenos (sirve para EPS y PDF). */
function svgToEntries(svgText: string): { W: number; H: number; vx: number; vy: number; entries: Entry[] } {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg") throw new Error("SVG inválido.");
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(parseFloat);
  const W = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(svg.getAttribute("width") ?? "1000");
  const H = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(svg.getAttribute("height") ?? "1000");
  const [vx, vy] = vb.length === 4 ? [vb[0], vb[1]] : [0, 0];

  const entries: Entry[] = [];
  const walk = (el: Element, inheritedFill: string | null, inheritedRule: string | null) => {
    const tag = el.nodeName.toLowerCase();
    if (["defs", "clippath", "mask", "title", "desc", "metadata", "style"].includes(tag)) return;
    const fill = styleProp(el, "fill") ?? inheritedFill;
    const rule = styleProp(el, "fill-rule") ?? inheritedRule;
    const opacity = parseFloat(styleProp(el, "opacity") ?? "1") * parseFloat(styleProp(el, "fill-opacity") ?? "1");
    if (opacity === 0) return;
    const t = el.getAttribute("transform");
    if (t) entries.push({ push: parseTransform(t) });

    let geom = "";
    const n = (a: string) => parseFloat(el.getAttribute(a) ?? "0");
    if (tag === "path") geom = pathToPs(el.getAttribute("d") ?? "");
    else if (tag === "rect") {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      geom = `${f(x)} ${f(y)} m ${f(x + w)} ${f(y)} l ${f(x + w)} ${f(y + h)} l ${f(x)} ${f(y + h)} l h`;
    } else if (tag === "polygon" || tag === "polyline") {
      const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(parseFloat);
      for (let i = 0; i + 1 < pts.length; i += 2) geom += `${f(pts[i])} ${f(pts[i + 1])} ${i ? "l" : "m"} `;
      geom += "h";
    } else if (tag === "circle") geom = ellipsePs(n("cx"), n("cy"), n("r"), n("r"));
    else if (tag === "ellipse") geom = ellipsePs(n("cx"), n("cy"), n("rx"), n("ry"));

    if (geom) {
      const c = parseColor(fill ?? "black");
      if (c) entries.push({ rgb: c, geom, evenodd: rule === "evenodd" });
    }
    for (const child of Array.from(el.children)) walk(child, fill, rule);
    if (t) entries.push({ pop: true });
  };
  walk(svg, null, null);
  return { W, H, vx, vy, entries };
}

const rgbText = (c: [number, number, number]) => `${f(c[0] / 255)} ${f(c[1] / 255)} ${f(c[2] / 255)}`;

export function svgToEps(svgText: string, title = "DiseñoIA"): string {
  const { W, H, vx, vy, entries } = svgToEntries(svgText);
  const body = entries.map((e) =>
    "push" in e
      ? `gsave [${e.push.map(f).join(" ")}] concat`
      : "pop" in e
        ? "grestore"
        : `${rgbText(e.rgb)} setrgbcolor newpath ${e.geom} ${e.evenodd ? "eofill" : "fill"}`,
  );
  return [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${f(W)} ${f(H)}`,
    `%%Title: ${title.replace(/[^\x20-\x7e]/g, "_")}`,
    "%%Creator: DisenoIA",
    "%%DocumentData: Clean7Bit",
    "%%LanguageLevel: 2",
    "%%EndComments",
    "/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def",
    "gsave",
    `0 ${f(H)} translate 1 -1 scale ${f(-vx)} ${f(-vy)} translate`,
    ...body,
    "grestore",
    "showpage",
    "%%EOF",
  ].join("\n");
}

/** PDF vectorial de una página (los operadores m/l/c/h son los mismos que en PostScript). */
export function svgToPdf(svgText: string): Blob {
  const { W, H, vx, vy, entries } = svgToEntries(svgText);
  const ops = entries.map((e) =>
    "push" in e ? `q ${e.push.map(f).join(" ")} cm` : "pop" in e ? "Q" : `${rgbText(e.rgb)} rg ${e.geom} ${e.evenodd ? "f*" : "f"}`,
  );
  const content = [`1 0 0 -1 0 ${f(H)} cm`, `1 0 0 1 ${f(-vx)} ${f(-vy)} cm`, ...ops].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
