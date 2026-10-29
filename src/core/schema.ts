// Validación y normalización del JSON de análisis (sin dependencias: más liviano que Zod).
import { getProduct } from "./catalog";
import { LIMITS } from "./limits";
import type {
  AnalysisResult,
  BackgroundArtwork,
  Behind,
  Box,
  Fragment,
  IndependentArtwork,
  ObjectKind,
  PieceAnalysis,
  View,
} from "./types";

const VIEWS: View[] = ["frente", "espalda", "lateral", "detalle"];
const KINDS: ObjectKind[] = ["logo", "texto", "parche", "etiqueta", "figura"];
const BEHIND: Behind[] = ["prenda", "estampa", "propio"];

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s ? s : null;
};
const strList = (v: unknown, max: number = LIMITS.lists): string[] =>
  arr(v).map((x) => str(x)).filter(Boolean).slice(0, max);
const bool = (v: unknown): boolean => v === true || v === "true";
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => {
  const s = str(v).toLowerCase() as T;
  return list.includes(s) ? s : fallback;
};

export function normalizeHex(v: unknown): string | null {
  const s = str(v).toLowerCase();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m6 = /^#?([0-9a-f]{6})$/.exec(s);
  return m6 ? `#${m6[1]}` : null;
}

const colors = (v: unknown): string[] =>
  [...new Set(arr(v).map(normalizeHex).filter((c): c is string => !!c))].slice(0, LIMITS.colors);

/** Acepta [x,y,w,h] en 0..1 o en 0..1000 y lo recorta a la imagen. */
export function normalizeBox(v: unknown): Box | null {
  let nums: number[];
  if (Array.isArray(v)) nums = v.map(Number);
  // Algunos modelos devuelven la caja como texto: "[0.39, 0.28, 0.21, 0.19]".
  else if (typeof v === "string") nums = (v.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  else {
    const o = obj(v);
    nums = [o.x, o.y, o.w ?? o.width, o.h ?? o.height].map(Number);
  }
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.some((n) => n > 1.5)) nums = nums.map((n) => n / 1000);
  let [x, y, w, h] = nums;
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(Math.max(w, 0), 1 - x);
  h = Math.min(Math.max(h, 0), 1 - y);
  if (w < 0.005 || h < 0.005) return null;
  return [x, y, w, h];
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

function fragment(v: unknown): Fragment | null {
  const o = obj(v);
  const box = normalizeBox(o.box_2d ?? o.box);
  if (!box) return null;
  return {
    view: str(o.view, "frente"),
    face: str(o.face, ""),
    box_2d: box,
    distortion: strList(o.distortion),
    fix: strList(o.fix),
    missing: strList(o.missing),
    issues: strList(o.issues),
  };
}

function background(v: unknown, productType: string): BackgroundArtwork | null {
  const o = obj(v);
  const fragments = arr(o.fragments).map(fragment).filter((f): f is Fragment => !!f).slice(0, LIMITS.fragments);
  if (!fragments.length) return null;
  const product = getProduct(productType);
  const surfaceId = str(o.surface);
  return {
    surface: product.surfaces.some((s) => s.id === surfaceId) ? surfaceId : product.surfaces[0].id,
    name: strOrNull(o.name),
    identity: str(o.identity),
    plain: bool(o.plain),
    style: strList(o.style, LIMITS.style),
    colors: colors(o.colors),
    mustInclude: strList(o.mustInclude),
    missing: strList(o.missing),
    seams: arr(o.seams)
      .map((s) => obj(s))
      .filter((s) => str(s.with))
      .map((s) => ({ with: str(s.with), continuous: s.continuous !== false }))
      .slice(0, LIMITS.lists),
    fragments,
  };
}

function independent(v: unknown): IndependentArtwork | null {
  const o = obj(v);
  const box = normalizeBox(o.box_2d ?? o.box);
  if (!box) return null;
  const aspect = Number(o.aspect);
  const text = Array.isArray(o.text) ? strList(o.text) : strOrNull(o.text) ? [str(o.text)] : [];
  return {
    kind: oneOf(o.kind, KINDS, "figura"),
    name: str(o.name, "Arte"),
    identity: str(o.identity),
    placement: str(o.placement),
    behind: oneOf(o.behind, BEHIND, "prenda"),
    surface: strOrNull(o.surface),
    view: strOrNull(o.view),
    style: strList(o.style, LIMITS.style),
    text,
    box_2d: box,
    more: arr(o.more_boxes ?? o.more)
      .map((b) => normalizeBox(b))
      .filter((b): b is Box => !!b)
      .slice(0, 3),
    distortion: strList(o.distortion),
    fix: strList(o.fix),
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : null,
    curved: bool(o.curved),
    photo: bool(o.photo),
    colors: colors(o.colors),
    mustInclude: strList(o.mustInclude),
    missing: strList(o.missing),
    holes: strList(o.holes),
    issues: strList(o.issues),
  };
}

function piece(v: unknown, index: number): PieceAnalysis {
  const o = obj(v);
  const product = getProduct(str(o.productType).toLowerCase());
  const variant = strOrNull(o.variant);
  return {
    id: str(o.id) || `pieza-${index + 1}`,
    productType: product.id,
    variant: variant && product.variants.some((x) => x.id === variant) ? variant : null,
    garmentColor: normalizeHex(o.garmentColor),
    views: arr(o.views)
      .map((x, i) => {
        const vo = obj(x);
        const box = normalizeBox(vo.box_2d ?? vo.box);
        return box
          ? { id: str(vo.id) || `vista-${i + 1}`, view: oneOf(vo.view, VIEWS, "frente"), box_2d: box, surfaces: strList(vo.surfaces) }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
    backgrounds: arr(o.backgrounds).map((b) => background(b, product.id)).filter((b): b is BackgroundArtwork => !!b),
    objects: arr(o.objects).map(independent).filter((b): b is IndependentArtwork => !!b),
  };
}

/** Extrae el primer objeto JSON de una respuesta de modelo (tolera ```json ... ```). */
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("La respuesta del modelo no contiene JSON válido.");
  }
}

export function normalizeAnalysis(raw: unknown): AnalysisResult {
  const o = obj(raw);
  const pieces = arr(o.pieces).map(piece);
  const sensitive = strList(o.sensitive);
  return { pieces, sensitive };
}

/** Descripción del esquema que se envía al modelo. */
export const ANALYSIS_SCHEMA_FOR_PROMPT = {
  pieces: [
    {
      id: "string",
      productType: "one of catalog productType",
      variant: "catalog variant id or null",
      garmentColor: "#RRGGBB of the base garment/product color or null",
      views: [{ id: "string", view: "frente|espalda|lateral|detalle", box_2d: [0.25, 0.3, 0.2, 0.15], surfaces: ["surface id"] }],
      backgrounds: [
        {
          surface: "catalog surface id",
          name: "string|null",
          identity: "short description of the all-over print",
          plain: "true if it is a single flat color with no pattern",
          style: ["max 6 descriptors"],
          colors: ["#RRGGBB, max 8"],
          mustInclude: ["max 12"],
          missing: ["max 12"],
          seams: [{ with: "surface id", continuous: true }],
          fragments: [
            {
              view: "frente|espalda|lateral|detalle",
              face: "front | back (for sleeves: which side of the garment this part is seen from)",
              box_2d: [0.25, 0.3, 0.2, 0.15],
              distortion: ["max 12"],
              fix: ["max 12"],
              missing: ["max 12"],
              issues: ["max 12"],
            },
          ],
        },
      ],
      objects: [
        {
          kind: "logo|texto|parche|etiqueta|figura",
          name: "short name",
          identity: "what it depicts",
          placement: "where it sits on the product",
          behind: "prenda|estampa|propio (what is visible behind it)",
          surface: "surface id or null",
          view: "view id or null",
          style: ["max 6"],
          text: ["exact visible text lines"],
          box_2d: [0.25, 0.3, 0.2, 0.15],
          more_boxes: "[[x,y,w,h], ...] other visible parts of this SAME element (e.g. a word that wraps around a sleeve), or []",
          distortion: ["max 12"],
          fix: ["max 12"],
          aspect: "width/height of the flat artwork or null",
          curved: false,
          photo: "true if it is photographic artwork",
          colors: ["#RRGGBB, max 8"],
          mustInclude: ["max 12"],
          missing: ["max 12"],
          holes: ["transparent areas inside the design"],
          issues: ["max 12"],
        },
      ],
    },
  ],
  sensitive: ["describe identifiable people or personal data, empty if none"],
};
