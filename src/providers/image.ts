// Proveedores de recreación de imagen (edición con referencias).
import { blobToCanvas, blobToDataURL, canvasToBlob, fitToRatio, getImageData, imageDataToCanvas, makeCanvas } from "../core/image";
import { removeBorderBackground } from "../core/matte";
import { ProviderError } from "../core/types";
import { request, sleep } from "./http";
import type { ImageEditProvider } from "./types";

const GEMINI_RATIOS: [string, number][] = [
  ["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4], ["4:3", 4 / 3],
  ["4:5", 4 / 5], ["5:4", 5 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9], ["21:9", 21 / 9],
];

export const nearestRatio = (r: number, table: [string, number][]) =>
  table.reduce((best, cur) => (Math.abs(Math.log(cur[1] / r)) < Math.abs(Math.log(best[1] / r)) ? cur : best))[0];

export function geminiImage(key: string, model: string): ImageEditProvider {
  return {
    id: "gemini",
    model,
    transparency: false,
    async recreate(input) {
      const parts = await Promise.all(
        input.references.map(async (r) => {
          const url = await blobToDataURL(r);
          return { inline_data: { mime_type: r.type || "image/png", data: url.slice(url.indexOf(",") + 1) } };
        }),
      );
      const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: input.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...parts, { text: input.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: nearestRatio(input.ratio, GEMINI_RATIOS) } },
        }),
      });
      const j = await res.json();
      const cand = j.candidates?.[0];
      if (j.promptFeedback?.blockReason || /SAFETY|PROHIBITED/.test(cand?.finishReason ?? "")) {
        throw new ProviderError("safety", "Bloqueado por el filtro de seguridad de Gemini.");
      }
      const img = cand?.content?.parts?.find((p: { inlineData?: unknown; inline_data?: unknown }) => p.inlineData || p.inline_data);
      const data = img?.inlineData ?? img?.inline_data;
      if (!data?.data) throw new ProviderError("no_output", "Gemini no devolvió imagen.");
      const bin = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
      return { image: new Blob([bin], { type: data.mimeType ?? data.mime_type ?? "image/png" }), nativeAlpha: false };
    },
  };
}

export function openaiImage(key: string, model: string, quality: string): ImageEditProvider {
  return {
    id: "openai",
    model,
    transparency: true,
    async recreate(input) {
      const size = input.ratio > 1.2 ? "1536x1024" : input.ratio < 0.83 ? "1024x1536" : "1024x1024";
      if (!input.references.length) {
        // Sin referencias: generación desde texto.
        const res = await request("https://api.openai.com/v1/images/generations", {
          method: "POST",
          signal: input.signal,
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, prompt: input.prompt, size, quality, background: input.background, output_format: "png", n: 1 }),
        });
        return decodeOpenAI(await res.json(), input.background);
      }
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      input.references.forEach((r, i) => form.append("image[]", r, `ref-${i + 1}.${r.type === "image/jpeg" ? "jpg" : "png"}`));
      form.append("size", size);
      form.append("quality", quality);
      form.append("background", input.background);
      form.append("output_format", "png");
      form.append("n", "1");
      const res = await request("https://api.openai.com/v1/images/edits", {
        method: "POST",
        signal: input.signal,
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      return decodeOpenAI(await res.json(), input.background);
    },
  };
}

function decodeOpenAI(j: { data?: { b64_json?: string }[] }, background: string) {
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("no_output", "OpenAI no devolvió imagen.");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { image: new Blob([bin], { type: "image/png" }), nativeAlpha: background === "transparent" };
}

/** Demo sin claves: devuelve la referencia principal limpiada localmente. Sirve para probar todo el flujo. */
export function demoImage(): ImageEditProvider {
  return {
    id: "demo",
    model: "demo",
    transparency: true,
    async recreate(input) {
      await sleep(700 + Math.random() * 800, input.signal);
      const ref = input.references[0];
      if (!ref) return { image: await canvasToBlob(demoArt(input.prompt, input.ratio)), nativeAlpha: true };
      const c = await blobToCanvas(ref);
      const out =
        input.background === "transparent"
          ? imageDataToCanvas(removeBorderBackground(getImageData(c)))
          : fitToRatio(c, input.ratio);
      return { image: await canvasToBlob(out), nativeAlpha: true };
    },
  };
}

/** Imagen de ejemplo para el modo demo cuando no hay referencia: composición CMY con el texto pedido. */
function demoArt(prompt: string, ratio: number): HTMLCanvasElement {
  const w = ratio >= 1 ? 1024 : Math.round(1024 * ratio);
  const h = ratio >= 1 ? Math.round(1024 / ratio) : 1024;
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  let seed = [...prompt].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  ctx.globalCompositeOperation = "multiply";
  for (const color of ["#00aeef", "#ec008c", "#fff200"]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w * (0.25 + rnd() * 0.5), h * (0.25 + rnd() * 0.5), Math.min(w, h) * (0.22 + rnd() * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#0a0a0a";
  ctx.font = `600 ${Math.round(Math.min(w, h) / 22)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(prompt.slice(0, 48) || "DiseñoIA", w / 2, h - Math.min(w, h) / 12);
  return c;
}
