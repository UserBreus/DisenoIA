// Motor de imágenes común a todas las herramientas: generar, editar con referencias y transparencia.
import { analysisProvider, imageProvider, toolsProvider } from "../providers";
import type { VectorOptions } from "../providers/types";
import { blobToCanvas, blobToDataURL, canvasToBlob, getImageData, imageDataToCanvas, makeCanvas, scaleToLongest, sha256 } from "./image";
import { extractAlpha, flattenOnKey, hasAlpha, keyOut, restoreAlpha, trim } from "./matte";
import { tracked } from "./ops";
import type { Settings } from "./settings";
import type { OpLog } from "./types";
import { uid } from "./queue";

export const TOOL_PROMPT_VERSION = "disenoia-tools-v1";

export interface ImageJob {
  /** Herramienta que lo pide (para el registro). */
  tool: string;
  operation: OpLog["operation"];
  prompt: string;
  /** Imágenes de referencia: la primera es la que se edita. Vacío = generar desde texto. */
  refs?: Blob[];
  ratio?: number;
  /** Resultado con fondo transparente (logos, letterings, recortes). */
  transparent?: boolean;
  signal?: AbortSignal;
}

/** Ejecuta una generación/edición y devuelve un PNG listo (con alfa real si se pidió transparente). */
export async function makeImage(settings: Settings, job: ImageJob): Promise<Blob> {
  const provider = imageProvider(settings);
  const keyBackground = !!job.transparent && !provider.transparency;
  const prompt =
    job.prompt +
    (job.transparent
      ? keyBackground
        ? "\nBackground: a perfectly flat, solid pure magenta (#FF00FF) background with no gradient, shadow or texture. Never use magenta inside the artwork."
        : "\nBackground: transparent."
      : "");
  const refs = await Promise.all((job.refs ?? []).map(prepareRef));
  const out = await tracked(
    {
      intent: uid("int-"),
      extractionId: job.tool,
      itemId: null,
      operation: job.operation,
      provider: provider.id,
      model: provider.model,
      inputHash: await sha256(prompt + (await Promise.all(refs.map((r) => sha256(r)))).join("")),
      promptVersion: TOOL_PROMPT_VERSION,
    },
    () => provider.recreate({ prompt, references: refs, ratio: job.ratio ?? 1, background: job.transparent ? "transparent" : "opaque", signal: job.signal }),
  );
  if (!job.transparent) return out.image;
  let d = getImageData(await blobToCanvas(out.image));
  if (!out.nativeAlpha || !hasAlpha(d)) d = keyOut(d);
  return canvasToBlob(imageDataToCanvas(trim(d)));
}

/** Referencias: lado mayor ≤ 2048 px y sin alfa (los generadores la descartan o la vuelven negra). */
async function prepareRef(b: Blob): Promise<Blob> {
  let c = await blobToCanvas(b);
  const scaled = Math.max(c.width, c.height) > 2048;
  if (scaled) c = scaleToLongest(c, 2048);
  const d = getImageData(c);
  if (hasAlpha(d)) return canvasToBlob(imageDataToCanvas(flattenOnKey(d, [255, 255, 255])), "image/png");
  return scaled ? canvasToBlob(c, "image/png") : b;
}

/** Pregunta a un modelo de visión sobre una imagen y devuelve su respuesta en texto. */
export async function askVision(
  settings: Settings,
  q: { tool: string; operation: OpLog["operation"]; image: Blob; system: string; prompt: string; task?: "fonts"; signal?: AbortSignal },
): Promise<string> {
  const provider = analysisProvider(settings);
  let c = await blobToCanvas(q.image);
  if (Math.max(c.width, c.height) > 1600) c = scaleToLongest(c, 1600);
  const image = await blobToDataURL(await canvasToBlob(c, "image/jpeg", 0.92));
  return tracked(
    {
      intent: uid("int-"),
      extractionId: q.tool,
      itemId: null,
      operation: q.operation,
      provider: provider.id,
      model: provider.model,
      inputHash: await sha256(image),
      promptVersion: TOOL_PROMPT_VERSION,
    },
    () => provider.ask({ image, system: q.system, prompt: q.prompt, task: q.task, signal: q.signal }),
  );
}

/** Ampliación clásica (local o FAL) conservando la transparencia. */
export async function upscaleClassic(settings: Settings, image: Blob, signal?: AbortSignal): Promise<Blob> {
  const tools = toolsProvider(settings);
  const d = getImageData(await blobToCanvas(image));
  const alpha = hasAlpha(d) ? extractAlpha(d) : null;
  const input = alpha && tools.id !== "local" ? await canvasToBlob(imageDataToCanvas(flattenOnKey(d))) : image;
  const result = await tools.upscale(input, signal);
  if (!alpha || tools.id === "local") return result;
  return canvasToBlob(imageDataToCanvas(restoreAlpha(getImageData(await blobToCanvas(result)), alpha)));
}

export const vectorizeImage = (settings: Settings, image: Blob, options?: VectorOptions, signal?: AbortSignal) =>
  toolsProvider(settings).vectorize(image, signal, options);

export const cutoutImage = async (settings: Settings, image: Blob, signal?: AbortSignal) =>
  canvasToBlob(imageDataToCanvas(trim(getImageData(await blobToCanvas(await toolsProvider(settings).cutout(image, signal))))));

/** Lleva una imagen a un tamaño exacto (múltiplo) con suavizado alto. */
export async function resizeTo(image: Blob, factor: number): Promise<Blob> {
  const src = await blobToCanvas(image);
  const [c, ctx] = makeCanvas(src.width * factor, src.height * factor);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return canvasToBlob(c);
}

export async function imageSize(b: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(b);
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

/** Convierte un SVG a PNG (para miniaturas, mockups y el TIFF). */
export async function rasterizeSvg(svg: string, maxSide = 2048): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const k = Math.min(1, maxSide / Math.max(w, h)) * (Math.max(w, h) < 1024 ? 1024 / Math.max(w, h) : 1);
    const [c, ctx] = makeCanvas(w * k, h * k);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return canvasToBlob(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}
