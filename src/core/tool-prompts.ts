// Prompts de cada herramienta. Las ediciones van en modo "editá esta imagen, conservá X": así el
// generador parte de la foto real en lugar de redibujar la escena desde una descripción.

export const STYLES = [
  { id: "realista", label: "Realista", text: "photorealistic, natural lighting, high detail" },
  { id: "anime", label: "Anime", text: "anime illustration style, clean cel shading, expressive line art" },
  { id: "acuarela", label: "Acuarela", text: "watercolor painting, soft washes, paper texture, organic edges" },
  { id: "caricatura", label: "Caricatura", text: "cartoon caricature style, bold outlines, exaggerated features, flat colors" },
  { id: "3d", label: "3D", text: "3D render, soft global illumination, smooth materials" },
  { id: "cine", label: "Cinematográfico", text: "cinematic still, dramatic lighting, shallow depth of field, film color grading" },
  { id: "vector", label: "Vector", text: "flat vector illustration, clean shapes, limited palette, crisp edges, print-ready" },
  { id: "grafico", label: "Gráfico", text: "bold graphic poster design, screen-print look, strong contrast, halftones" },
  { id: "libre", label: "Libre", text: "" },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

export const RATIOS = [
  { id: "1:1", value: 1 },
  { id: "4:5", value: 4 / 5 },
  { id: "3:2", value: 3 / 2 },
  { id: "2:3", value: 2 / 3 },
  { id: "16:9", value: 16 / 9 },
  { id: "9:16", value: 9 / 16 },
] as const;

export function generatorPrompt(idea: string, style: StyleId, forPrint: boolean): string {
  const s = STYLES.find((x) => x.id === style)?.text;
  return [
    idea.trim(),
    s ? `Style: ${s}.` : "",
    forPrint ? "It will be printed on textiles: crisp details, rich saturated colors, no watermark, no signature, no frame." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const PRODUCTS_FOR_CREATOR = [
  { id: "camiseta", label: "Camiseta", ratio: 3 / 2, view: "a T-shirt shown flat, front view on the left and back view on the right" },
  { id: "camiseta-deportiva", label: "Camiseta deportiva", ratio: 3 / 2, view: "a sublimated sports jersey shown flat, front on the left and back on the right" },
  { id: "taza", label: "Taza", ratio: 3 / 2, view: "a white ceramic mug from the front, with the print wrapping around it" },
  { id: "banner", label: "Banner", ratio: 16 / 9, view: "a horizontal advertising banner, flat and front-facing" },
  { id: "wind-banner", label: "Wind banner", ratio: 2 / 3, view: "a vertical feather flag (wind banner) on its pole, front view" },
  { id: "shorts", label: "Shorts", ratio: 3 / 2, view: "sports shorts shown flat, front view" },
] as const;

export type CreatorProduct = (typeof PRODUCTS_FOR_CREATOR)[number]["id"];

export function creatorPrompt(idea: string, product: CreatorProduct, variant: number): string {
  const p = PRODUCTS_FOR_CREATOR.find((x) => x.id === product)!;
  return [
    `Design a print-ready product concept: ${p.view}.`,
    `Client brief: ${idea.trim()}`,
    variant === 0
      ? "Interpretation A: follow the brief closely with a balanced, professional composition."
      : "Interpretation B: a bolder, more creative take on the same brief, different layout and color emphasis.",
    "Show the whole product clearly on a plain light-gray studio background, evenly lit, no model, no hands, no extra props.",
    "All logos, texts, numbers and patterns must be sharp and legible so they can be extracted for production. Spell every text exactly as in the brief.",
  ].join("\n");
}

export function magicBackgroundPrompt(scene: string): string {
  return [
    "Edit the provided image. Keep the main subject EXACTLY as it is: same shape, colors, details, text, position and scale. Do not redraw or restyle it.",
    `Replace only the background with: ${scene.trim()}.`,
    "Match lighting and perspective so the subject sits naturally in the new scene. No added text or watermarks.",
  ].join("\n");
}

export type RecreateMode = "limpiar" | "variacion" | "estilo";

export function recreatorPrompt(mode: RecreateMode, notes: string, style?: StyleId): string {
  const extra = notes.trim() ? `\nAdditional instructions: ${notes.trim()}` : "";
  if (mode === "limpiar") {
    return `Edit the provided image. Redraw this artwork as a clean, high-resolution, print-ready version: identical composition, shapes, text, colors and proportions. Remove blur, JPEG artifacts, noise, folds, shadows and perspective. Make edges crisp and colors flat where they are flat in the original. Do not add or remove any element.${extra}`;
  }
  if (mode === "variacion") {
    return `Edit the provided image. Create a fresh variation of this artwork: keep the same subject, theme, color palette and overall style, but change the composition and details so it is a new, original design of the same quality.${extra}`;
  }
  const s = STYLES.find((x) => x.id === style)?.text || "a different art style";
  return `Edit the provided image. Recreate this exact artwork (same subject, composition, text and layout) in this new style: ${s}. Keep every text spelled exactly as in the original.${extra}`;
}

export function aiUpscalePrompt(): string {
  return "Edit the provided image. Re-render it at the highest resolution with crisper edges and finer detail. The content must stay IDENTICAL: same composition, shapes, text, colors and proportions. Remove compression artifacts and noise. Do not add, remove or restyle anything.";
}

export function vectorPrepPrompt(colors: number): string {
  return `Edit the provided image. Prepare it for vectorization: redraw it as clean flat artwork with sharp edges, solid color areas (about ${colors} colors), no gradients, no noise, no texture and no shadows. Keep the design, text and proportions identical. Do not add or remove elements.`;
}

export function fontCreatorPrompt(text: string, style: string, colors: string): string {
  return [
    `Create a stand-alone lettering artwork of exactly this text: "${text.trim()}".`,
    "Copy every character exactly (letters, accents, capitalization, punctuation). Nothing else may be written.",
    `Lettering style: ${style.trim() || "bold modern display lettering"}.`,
    colors.trim() ? `Colors: ${colors.trim()}.` : "",
    "Centered, front-facing, flat graphic for textile printing, crisp edges, no mockup, no garment, no scene.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const FONT_FINDER_SYSTEM =
  "You are an expert typographer. You identify typefaces from images of text with precision and you know the Google Fonts catalog thoroughly.";

export function fontFinderPrompt(): string {
  return `Identify the typeface used in the text of this image.
Return JSON only, with this shape:
{"text":"the visible text","fonts":[{"name":"exact font family name","category":"serif|sans-serif|display|handwriting|monospace|script","confidence":0.0-1.0,"google":true|false,"why":"short reason in Spanish"}]}
List the best match first and give 5 candidates in total. When the exact font is commercial, also include the closest Google Fonts alternatives (google:true). Use exact family names.`;
}

// ---------- Vectorizado preciso por objetos ----------

export const VECTOR_PLAN_SYSTEM =
  "You are a senior vector artist. You break artwork into clean, separately vectorizable elements and you read flat fill colors precisely.";

export function vectorPlanPrompt(): string {
  return `Prepare this image for professional vectorization.
Return JSON only, with this shape:
{"background":{"type":"transparent|solid|complex","color":"#RRGGBB or null","colors":["#RRGGBB"]},
 "objects":[{"name":"short name","kind":"text|logo|icon|shape|illustration","text":"exact visible text or empty","box":[x,y,w,h],"colors":["#RRGGBB"],"z":0}]}
Rules:
- One object per logical element: a word or line of text, a logo, an emblem, an icon, a character, a decorative shape. Never split a word into letters or a logo into pieces.
- Patterns, scenery, textures, splatters and any artwork that sits BEHIND the main elements are part of the background: do not list them as objects; set background.type to "complex" instead.
- "box" is the TIGHT bounding box of the element, normalized 0..1 relative to the full image ([x, y, width, height]), as a JSON array of numbers.
- "colors" are the 2 to 8 flat fill colors a vector artist would use for that element, exact hex (include black and white when present). No near-duplicates.
- "z" is the stacking order: 0 = furthest back. Elements on top of others get higher numbers.
- "background": "transparent" if there is no background, "solid" if it is one flat color (give it), "complex" if it is a pattern, scene or texture that must also be vectorized. For "complex", "colors" lists its 2 to 8 flat fill colors (exact hex); only those colors may appear in the background.
- At most 14 objects. If the whole image is a single illustration, return one object covering it.`;
}

const PREP_FORBIDDEN =
  "Forbidden: gradients, shading, highlights, glow, drop shadows, 3D effects, textures, grain, halftone dots, noise, blur, soft or feathered edges, JPEG artifacts, and any outline that is not in the original.";

const PREP_GEOMETRY =
  "Edges razor sharp and clean. Straight lines perfectly straight, curves smooth and continuous with no wobble, circles perfectly round, corners crisp, symmetric parts exactly symmetric, consistent stroke widths.";

export function vectorPrepObjectPrompt(o: { name: string; kind: string; text: string; colors: string[] }, others: string[] = []): string {
  return [
    `Edit the provided image. It is a crop that contains ONE element of a design: ${o.kind} "${o.name}"${o.text ? ` with the exact text "${o.text}"` : ""}.`,
    "Redraw ONLY this element as clean flat artwork that will be converted to vectors automatically, so it must be flawless for vectorization:",
    `- Identical design: same silhouette, proportions, internal details, stroke thickness, spacing and position in the frame. Do not simplify, stylize, add or remove anything.${o.text ? " Copy every character exactly with the same letterforms, weight and spacing." : ""}`,
    `- Flat solid fills only, using exactly these colors: ${o.colors.length ? o.colors.join(", ") : "the original flat colors"}. Every area is one perfectly uniform color.`,
    `- ${PREP_FORBIDDEN}`,
    `- ${PREP_GEOMETRY}`,
    `- Remove everything that is not this element: garment, fabric, folds and the background${others.length ? `, and these other elements that are separate layers (erase them completely, do not redraw any of their shapes or letters): ${others.join("; ")}` : ""}.`,
    "- Keep the same framing as the input crop, with the element fully visible, at the highest resolution.",
  ].join("\n");
}

export function vectorPrepBackgroundPrompt(colors: string[], foreground: string[]): string {
  return [
    "Edit the provided image. Redraw ONLY the background layer of this design as clean flat artwork for automatic vectorization.",
    `- Remove every foreground element${foreground.length ? ` (${foreground.join(", ")})` : ""} and continue the background naturally behind them.`,
    "- Same composition, scale and proportions; fill the whole canvas edge to edge.",
    `- Flat solid fills only, using exactly these colors: ${colors.length ? colors.join(", ") : "the original flat colors"}.`,
    `- ${PREP_FORBIDDEN}`,
    `- ${PREP_GEOMETRY}`,
  ].join("\n");
}
