// Proveedores de análisis (visión → JSON). Llamadas directas desde el navegador con la clave del usuario.
import { normalizeAnalysis } from "../core/schema";
import { estimateBorderColor } from "../core/matte";
import { dataUrlToBlob, getImageData, scaleToLongest } from "../core/image";
import { ProviderError, type Box } from "../core/types";
import { request, sleep } from "./http";
import type { AnalysisInput, AnalysisProvider } from "./types";

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);
const mime = (dataUrl: string) => dataUrl.slice(5, dataUrl.indexOf(";"));

function finish(text: string | undefined | null): string {
  if (!text) throw new ProviderError("no_output", "El modelo no devolvió contenido.");
  return text;
}

export function geminiAnalysis(key: string, model: string): AnalysisProvider {
  return {
    id: "gemini",
    model,
    async ask(input: AnalysisInput) {
      const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: input.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime(input.image), data: b64(input.image) } }, { text: input.prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      });
      const j = await res.json();
      if (j.promptFeedback?.blockReason) throw new ProviderError("safety", `Bloqueado: ${j.promptFeedback.blockReason}`);
      const text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      return finish(text);
    },
  };
}

/** Cualquier API compatible con OpenAI Chat Completions (OpenAI, OpenRouter, gateways propios). */
export function openaiAnalysis(key: string, model: string, baseUrl: string): AnalysisProvider {
  const call = async (input: AnalysisInput, withTemperature: boolean) =>
    request(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: input.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        ...(withTemperature ? { temperature: 0.1 } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: input.image } }] },
        ],
      }),
    });
  return {
    id: "openai",
    model,
    async ask(input) {
      let res: Response;
      try {
        res = await call(input, true);
      } catch (e) {
        // Algunos modelos de razonamiento sólo aceptan la temperatura por defecto.
        if (e instanceof ProviderError && e.status === 400 && /temperature/i.test(e.message)) res = await call(input, false);
        else throw e;
      }
      const j = await res.json();
      const choice = j.choices?.[0];
      if (choice?.finish_reason === "content_filter") throw new ProviderError("safety", "Bloqueado por filtro de contenido.");
      return finish(choice?.message?.content);
    },
  };
}

export function anthropicAnalysis(key: string, model: string): AnalysisProvider {
  return {
    id: "anthropic",
    model,
    async ask(input) {
      const res = await request("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: input.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          temperature: 0.1,
          system: input.system,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mime(input.image), data: b64(input.image) } },
                { type: "text", text: input.prompt },
              ],
            },
          ],
        }),
      });
      const j = await res.json();
      if (j.stop_reason === "refusal") throw new ProviderError("safety", "El modelo rechazó la solicitud.");
      const text = j.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      return finish(text);
    },
  };
}

/** Modo demo sin claves: detecta la zona con contenido por contraste con el borde. */
export function demoAnalysis(): AnalysisProvider {
  return {
    id: "demo",
    model: "demo",
    async ask(input) {
      await sleep(500, input.signal);
      if (input.task === "fonts") return JSON.stringify(DEMO_FONTS);
      const bmp = await createImageBitmap(await dataUrlToBlob(input.image));
      const small = getImageData(scaleToLongest(bmp, 200, true));
      bmp.close();
      const box = contentBox(small);
      const art: Box = [box[0] + box[2] * 0.2, box[1] + box[3] * 0.15, box[2] * 0.6, box[3] * 0.45];
      return JSON.stringify(normalizeAnalysis({
        pieces: [
          {
            id: "pieza-1",
            productType: "camiseta",
            variant: "manga-corta",
            garmentColor: null,
            views: [{ id: "vista-1", view: "frente", box_2d: box, surfaces: ["frente"] }],
            backgrounds: [
              {
                surface: "frente",
                name: "Fondo del frente (demo)",
                identity: "all-over print",
                plain: false,
                fragments: [{ view: "frente", face: "frente", box_2d: box }],
              },
            ],
            objects: [
              {
                kind: "figura",
                name: "Arte principal (demo)",
                identity: "main printed artwork",
                placement: "chest",
                box_2d: art,
                issues: ["modo demo: caja estimada sin IA"],
              },
            ],
          },
        ],
        sensitive: [],
      }));
    },
  };
}

const DEMO_FONTS = {
  text: "texto de ejemplo",
  fonts: [
    { name: "Bebas Neue", category: "display", confidence: 0.4, google: true, why: "modo demo: sugerencia genérica" },
    { name: "Permanent Marker", category: "handwriting", confidence: 0.3, google: true, why: "modo demo" },
    { name: "Anton", category: "sans-serif", confidence: 0.2, google: true, why: "modo demo" },
  ],
};

function contentBox(d: ImageData): Box {
  const k = estimateBorderColor(d);
  const { width: w, height: h, data: p } = d;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dist = Math.hypot(p[i] - k[0], p[i + 1] - k[1], p[i + 2] - k[2]) / 441.7;
      if (dist > 0.15 && p[i + 3] > 64) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || (maxX - minX) * (maxY - minY) > w * h * 0.97) return [0.15, 0.1, 0.7, 0.8];
  return [minX / w, minY / h, (maxX - minX + 1) / w, (maxY - minY + 1) / h];
}
