// Prompts propios y versionados. Cambiar PROMPT_VERSION cada vez que se modifique un texto.
import { catalogForPrompt, getProduct, getSurface, surfaceRulesForPrompt } from "./catalog";
import { ANALYSIS_SCHEMA_FOR_PROMPT } from "./schema";
import type { BackgroundArtwork, IndependentArtwork } from "./types";

export const PROMPT_VERSION = "disenoia-v4";

export const ANALYSIS_SYSTEM = `You are a production artwork analyst for textile printing, sublimation,
screen printing and promotional products.

Analyze the supplied photograph or catalog image. Identify every physical
product shown, its visible views and the printable artwork that appears on it.

Separate printable artwork into:
- independent objects: logo, texto, parche, etiqueta or figura;
- printed backgrounds that belong to an entire printable surface.

Do not classify the garment itself, seams, fabric wrinkles, shadows, buttons,
zippers, drawstrings, eyelets, ribbing or garment hardware as artwork.

Return every box_2d as a JSON array of 4 numbers [x, y, width, height], each between
0 and 1, relative to the full image (never as a string). Describe only evidence visible in the image.
Do not invent unreadable text. Put uncertainty, occlusion, perspective, folds and
missing regions in the corresponding issue arrays.

For each artwork record its identity, placement, exact visible text, dominant
hex colors, visual style, required details, missing details, distortion,
aspect ratio and whether it is curved around the product.

For background prints, identify the product surface and every visible fragment.
Preserve continuity between matching faces or paired surfaces.

For garments (T-shirts, jerseys, shorts):
- "left" and "right" ALWAYS mean the WEARER's left and right. In a FRONT view the wearer's left sleeve
  appears on the RIGHT side of the image; in a BACK view the wearer's left sleeve appears on the LEFT side.
- List one background for EVERY printable surface that is visible: front torso, back torso, left sleeve,
  right sleeve (and each shorts leg). A sleeve gets one fragment per view where it can be seen, with
  face "front" (the part of the sleeve seen from the front of the garment) or "back" (seen from the back).
- An element that wraps around the product (for example a sponsor word on a sleeve, partly visible in the
  front view and partly in the back view) is ONE object: give its complete text, its largest visible part as
  box_2d and every other visible part in more_boxes. Never list pieces of one word or logo as separate objects.

Flag identifiable people or sensitive personal information in "sensitive".

Return JSON only and conform exactly to the supplied schema.`;

export function analysisUserPrompt(): string {
  return `Analyze this source image for production reconstruction.

Supported product catalog:
${JSON.stringify(catalogForPrompt())}

Output schema:
${JSON.stringify(ANALYSIS_SCHEMA_FOR_PROMPT)}

Rules for surfaces:
${JSON.stringify(surfaceRulesForPrompt())}

Do not include explanatory prose outside the JSON object.`;
}

const list = (v: string[] | undefined | null) => (v && v.length ? v.join("; ") : "none");

export interface ReferenceNotes {
  /** Cantidad de imágenes adjuntas. La primera es siempre el objetivo a editar. */
  count: number;
  /** Imágenes auxiliares después de la 1: otras partes visibles del mismo elemento. */
  aux?: number;
  /** La última imagen es la foto completa con el objetivo marcado (sólo contexto). */
  context?: boolean;
  /** El proveedor no admite transparencia nativa: pedir fondo clave. */
  keyBackground: boolean;
  /** Elementos separados que tapan al objetivo y hay que quitar (en vez de taparlos con gris). */
  remove: string[];
}

// Los prompts están escritos en modo EDICIÓN: el generador debe partir de la foto adjunta y
// conservarla, no redibujar la escena desde una descripción (eso hace que invente contenido).

const ratioText = (r: number) => `${r.toFixed(2)} (width/height)`;
const quoted = (t: string[]) => t.map((x) => `"${x}"`).join(" / ");

function attachedBlock(n: ReferenceNotes): string {
  const parts = ["Image 1 is the edit target."];
  const aux = n.aux ?? Math.max(0, n.count - 1 - (n.context ? 1 : 0));
  if (aux > 0) {
    parts.push(
      aux === 1
        ? "Image 2 shows another visible part of the same element (it continues around the product): combine both into the complete element."
        : `Images 2-${1 + aux} show other visible parts of the same element (it continues around the product): combine them into the complete element.`,
    );
  }
  if (n.context) {
    parts.push(
      `Image ${n.count} is the whole photo, for context only: the target is outlined with a thin cyan rectangle. Use it to understand what the target is and where it sits on the product. Never draw the rectangle and never copy anything else from that photo.`,
    );
  }
  return parts.join(" ");
}

function backgroundRule(n: ReferenceNotes): string {
  return n.keyBackground
    ? "Place it on a perfectly flat, solid pure magenta (#FF00FF) background with no gradient, shadow or texture; never use magenta inside the artwork."
    : "Place it on a transparent background.";
}

export function correctionBlock(feedback: string | null | undefined): string {
  if (!feedback?.trim()) return "";
  return `

CORRECTION of the previous result. Change only these problems:
${feedback.trim()}
Keep everything else exactly as before.`;
}

export function objectPrompt(
  art: IndependentArtwork,
  ratio: number,
  notes: ReferenceNotes,
  garmentColor: string | null,
  feedback: string | null,
): string {
  const text = art.text.length
    ? ` with the exact text ${quoted(art.text)} — copy every character exactly as written (letters, accents, capitalization); never turn letters into numbers or vice versa`
    : "";
  const lines = [
    `Edit the provided image. ${attachedBlock(notes)}`,
    `Extract ONLY the ${art.kind} "${art.name}"${text}, and output it as a clean, flat, front-facing print graphic.`,
    `KEEP ITS EXACT DESIGN: same lettering style, shapes, outlines, effects, colors, details and proportions as in the photo${art.curved ? "; flatten the curvature around the product" : ""}. Do not restyle or simplify it.`,
    `REMOVE everything else: the garment${garmentColor ? ` (${garmentColor})` : ""}, fabric texture, folds, shadows, lighting, perspective and the background print around it${notes.remove.length ? `, and these overlapping elements: ${notes.remove.join("; ")}` : ""}.`,
    backgroundRule(notes),
    `Center it with a small even margin. Target aspect ratio about ${ratioText(ratio)}. Do not add anything new.`,
    `Reference notes — identity: ${art.identity || art.name}; must include: ${list(art.mustInclude)}; colors: ${list(art.colors)}; transparent holes: ${list(art.holes)}.`,
  ];
  return lines.join("\n") + correctionBlock(feedback);
}

export function backgroundPrompt(
  bg: BackgroundArtwork,
  productType: string,
  variant: string | null,
  notes: ReferenceNotes,
  feedback: string | null,
): string {
  const product = getProduct(productType);
  const surface = getSurface(productType, bg.surface, variant);
  const lines = [
    `Edit the provided image. ${attachedBlock(notes)}`,
    `Turn the printed ${surface.label.toLowerCase()} of this ${product.label.toLowerCase()}${variant ? ` (${variant})` : ""} into ONE flat, rectangular, print-ready panel with aspect ratio ${ratioText(surface.ratio)}.`,
    "KEEP THE EXACT EXISTING ILLUSTRATION: the same subjects, buildings, figures, objects, line work, textures, splatters and colors, in the same positions and at the same scale. Do not redraw it in another style and never replace an element with a different one.",
    `REMOVE only: the garment itself (collar, sleeves, hems, seams, folds, shading, fabric texture and the background around the product)${notes.remove.length ? ` and these separate artworks printed on top: ${notes.remove.join("; ")}` : ""}. Where something is removed or hidden, continue the surrounding illustration seamlessly.`,
    "Fill the entire canvas edge to edge. No garment, mockup, border or added text.",
    `Surface rules: ${list([...product.rules, ...surface.rules])}`,
    `Reference notes — subject: ${bg.identity || bg.name || "all-over print"}; must include: ${list(bg.mustInclude)}; colors: ${list(bg.colors)}; style: ${list(bg.style)}.`,
  ];
  if (bg.seams.length) lines.push(`Continuity: must join seamlessly with ${bg.seams.map((s) => s.with).join(", ")}.`);
  return lines.join("\n") + correctionBlock(feedback);
}

export function groupPrompt(
  members: { art: IndependentArtwork; place: string }[],
  mode: "posicion" | "lado_a_lado",
  ratio: number,
  notes: ReferenceNotes,
  feedback: string | null,
): string {
  const parts = members
    .map((m, i) => `${i + 1}. ${m.art.kind} "${m.art.name}"${m.art.text.length ? ` — exact text ${quoted(m.art.text)}` : ""}; ${m.place}`)
    .join("\n");
  const lines = [
    `Edit the provided image. ${attachedBlock(notes)}`,
    `Extract ONLY these printed artworks and output them as ONE clean, flat, front-facing print graphic:`,
    parts,
    mode === "posicion"
      ? "Keep every part in its original relative position, overlap and scale."
      : "Place the parts side by side, left to right in the listed order, each keeping its own proportions.",
    "KEEP THE EXACT DESIGN of each part (lettering, shapes, outlines, colors, details); copy every text character exactly.",
    `REMOVE everything else: garment, fabric, folds, shadows and the background print${notes.remove.length ? `, and: ${notes.remove.join("; ")}` : ""}.`,
    backgroundRule(notes),
    `Target aspect ratio about ${ratioText(ratio)}. Do not add anything new.`,
  ];
  return lines.join("\n") + correctionBlock(feedback);
}

/**
 * Manga completa como pieza de molde: la parte vista de frente y la vista de espalda se unen en un solo
 * panel plano, con la línea superior del brazo en el centro (sin costura).
 */
export function sleevePrompt(
  bg: BackgroundArtwork,
  productType: string,
  variant: string | null,
  side: "left" | "right",
  views: { front: boolean; back: boolean },
  notes: ReferenceNotes,
  feedback: string | null,
): string {
  const surface = getSurface(productType, bg.surface, variant);
  const long = !!variant && variant.endsWith("larga");
  const frontHalf = side === "left" ? "LEFT" : "RIGHT";
  const backHalf = side === "left" ? "RIGHT" : "LEFT";
  const imgs: string[] = [];
  let i = 1;
  if (views.front) imgs.push(`image ${i++} shows the part of this sleeve visible from the FRONT of the garment`);
  if (views.back) imgs.push(`image ${i++} shows the part visible from the BACK of the garment`);
  const lines = [
    `Edit the provided images. They show the wearer's ${side.toUpperCase()} sleeve of a ${long ? "long" : "short"}-sleeve sublimated garment: ${imgs.join("; ")}.`,
    notes.context ? `Image ${notes.count} is the whole photo for context only (the sleeve is outlined in cyan); never draw the rectangle.` : "",
    `Create the COMPLETE flat print panel of this sleeve, like a sewing-pattern piece laid flat, aspect ratio ${ratioText(surface.ratio)}:`,
    "- the vertical center line of the panel is the top line of the arm (shoulder line) and the bottom edge is the cuff;",
    `- the ${frontHalf} half shows the front part of the sleeve and the ${backHalf} half shows the back part;`,
    "- both halves join seamlessly along the center line: no seam, no gap, no mirrored repetition; the pattern continues across.",
    views.front && views.back ? "" : `- only the ${views.front ? "front" : "back"} part is visible: continue the same pattern naturally on the other half.`,
    "KEEP THE EXACT EXISTING ILLUSTRATION: same motifs, colors, line work and scale as in the photos. Do not redraw it in another style and never replace an element with a different one.",
    `REMOVE: the garment itself (folds, shading, fabric texture, seams, cuff ribbing and the background around the product)${notes.remove.length ? ` and these separate artworks printed on top: ${notes.remove.join("; ")}` : ""}. Where something is removed or hidden, continue the surrounding print seamlessly.`,
    "Fill the entire canvas edge to edge. No garment, mockup, border or added text.",
    `Reference notes — subject: ${bg.identity || bg.name || "sleeve print"}; colors: ${list(bg.colors)}; style: ${list(bg.style)}.`,
  ];
  return lines.filter(Boolean).join("\n") + correctionBlock(feedback);
}
