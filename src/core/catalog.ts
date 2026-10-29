// Catálogo geométrico de productos, superficies y reglas de reconstrucción.

export interface Surface {
  id: string;
  label: string;
  /** Proporción ancho/alto del panel plano. */
  ratio: number;
  rules: string[];
}

export interface Product {
  id: string;
  label: string;
  ratio: number;
  exactRatio: boolean;
  surfaces: Surface[];
  variants: { id: string; label: string }[];
  rules: string[];
}

const SLEEVE_RULES = [
  "A sleeve is an open tube laid flat.",
  "Front and back faces of the sleeve join along the top line of the arm; that join is NOT a seam and must not be drawn.",
  "The pattern must continue seamlessly across both faces of the sleeve.",
];

const TORSO_RULES = [
  "Front and back torso panels do not include the sleeves.",
  "Collar ribbing, labels, seams and hems belong to the garment, not to the print.",
];

const LEG_RULES = [
  "Each shorts leg is opened flat into a single panel.",
  "Drawstring, eyelets, buttons, zipper and elastic texture belong to the garment, not to the print.",
  "The printed background must continue through the areas where garment hardware was.",
];

export const PRODUCTS: Product[] = [
  {
    id: "camiseta",
    label: "Camiseta",
    ratio: 4 / 5,
    exactRatio: false,
    variants: [
      { id: "manga-corta", label: "Manga corta" },
      { id: "manga-larga", label: "Manga larga" },
      { id: "sin-mangas", label: "Sin mangas" },
      { id: "raglan-corta", label: "Raglán manga corta" },
      { id: "raglan-larga", label: "Raglán manga larga" },
    ],
    surfaces: [
      { id: "frente", label: "Frente", ratio: 4 / 5, rules: TORSO_RULES },
      { id: "espalda", label: "Espalda", ratio: 4 / 5, rules: TORSO_RULES },
      { id: "manga-izquierda", label: "Manga izquierda", ratio: 3 / 2, rules: SLEEVE_RULES },
      { id: "manga-derecha", label: "Manga derecha", ratio: 3 / 2, rules: SLEEVE_RULES },
    ],
    rules: ["The printed background must continue through areas covered by garment accessories."],
  },
  {
    id: "taza",
    label: "Taza",
    ratio: 9 / 4,
    exactRatio: true,
    variants: [],
    surfaces: [
      {
        id: "envolvente",
        label: "Envolvente",
        ratio: 9 / 4,
        rules: [
          "The mug wrap is one flat rectangle.",
          "The center of the rectangle is the front view; both ends meet behind the handle and must join seamlessly.",
        ],
      },
    ],
    rules: [],
  },
  {
    id: "banner",
    label: "Banner",
    ratio: 3,
    exactRatio: false,
    variants: [],
    surfaces: [{ id: "frente", label: "Frente", ratio: 3, rules: ["Flat horizontal banner, remove grommets and folds."] }],
    rules: [],
  },
  {
    id: "wind-banner",
    label: "Wind banner",
    ratio: 1 / 2.5,
    exactRatio: true,
    variants: [],
    surfaces: [
      { id: "frente", label: "Frente", ratio: 1 / 2.5, rules: ["Flat vertical flag, remove the pole sleeve and wind curvature."] },
    ],
    rules: [],
  },
  {
    id: "shorts",
    label: "Shorts",
    ratio: 1,
    exactRatio: false,
    variants: [],
    surfaces: [
      { id: "pierna-izquierda", label: "Pierna izquierda", ratio: 1, rules: LEG_RULES },
      { id: "pierna-derecha", label: "Pierna derecha", ratio: 1, rules: LEG_RULES },
    ],
    rules: [],
  },
  {
    id: "otro",
    label: "Otro producto",
    ratio: 1,
    exactRatio: false,
    variants: [],
    surfaces: [{ id: "frente", label: "Frente", ratio: 1, rules: ["Flatten the printable surface and remove product shape."] }],
    rules: [],
  },
];

const LONG_SLEEVE_RATIO = 2 / 5;

export function getProduct(id: string | null | undefined): Product {
  return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[PRODUCTS.length - 1];
}

export function getSurface(productId: string, surfaceId: string | null, variant?: string | null): Surface {
  const product = getProduct(productId);
  const surface = product.surfaces.find((s) => s.id === surfaceId) ?? product.surfaces[0];
  if (surface.id.startsWith("manga") && variant && variant.endsWith("larga")) {
    return { ...surface, ratio: LONG_SLEEVE_RATIO };
  }
  return surface;
}

export function surfaceLabel(productId: string, surfaceId: string | null): string {
  return getProduct(productId).surfaces.find((s) => s.id === surfaceId)?.label ?? surfaceId ?? "Superficie";
}

/** Versión compacta del catálogo para el prompt de análisis. */
export function catalogForPrompt() {
  return PRODUCTS.map((p) => ({
    productType: p.id,
    variants: p.variants.map((v) => v.id),
    surfaces: p.surfaces.map((s) => s.id),
  }));
}

export function surfaceRulesForPrompt() {
  return Object.fromEntries(
    PRODUCTS.map((p) => [p.id, [...p.rules, ...p.surfaces.flatMap((s) => s.rules.map((r) => `${s.id}: ${r}`))]]),
  );
}
