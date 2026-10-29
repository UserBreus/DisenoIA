// FAL: cola (crear → consultar estado → leer resultado), recreación, vectorización, ampliación y recorte de fondo.
import { blobToDataURL } from "../core/image";
import { FAL_MODELS } from "../core/settings";
import { ProviderError } from "../core/types";
import { request, sleep } from "./http";
import type { ImageEditProvider, ToolsProvider } from "./types";

async function falQueue<T>(key: string, model: string, input: unknown, signal?: AbortSignal, firstPollMs = 2500): Promise<T> {
  const headers = { authorization: `Key ${key}`, "content-type": "application/json" };
  const submit = await request(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(input), signal });
  const job = await submit.json();
  const statusUrl: string = job.status_url ?? `https://queue.fal.run/${model}/requests/${job.request_id}/status`;
  const responseUrl: string = job.response_url ?? `https://queue.fal.run/${model}/requests/${job.request_id}`;
  const started = Date.now();
  let wait = firstPollMs;
  for (;;) {
    await sleep(wait, signal);
    const st = await (await request(statusUrl, { headers, signal })).json();
    if (st.status === "COMPLETED") break;
    if (st.status === "FAILED" || st.error) throw new ProviderError("gateway", `FAL: ${st.error ?? "trabajo fallido"}`);
    if (Date.now() - started > 300_000) throw new ProviderError("timeout", "FAL tardó más de 5 minutos.");
    wait = Math.min(wait * 1.3, 6000);
  }
  return (await request(responseUrl, { headers, signal })).json();
}

const fetchBlob = async (url: string, signal?: AbortSignal) => (await request(url, { signal })).blob();

export function falImage(key: string, model: string): ImageEditProvider {
  return {
    id: "fal",
    model,
    transparency: false,
    async recreate(input) {
      const image_urls = await Promise.all(input.references.map(blobToDataURL));
      // Sin referencias se usa la variante de generación del mismo modelo (…/edit → …).
      const endpoint = image_urls.length ? model : model.replace(/\/edit$/, "");
      const out = await falQueue<{ images?: { url: string }[] }>(
        key,
        endpoint,
        { prompt: input.prompt, ...(image_urls.length ? { image_urls } : {}), num_images: 1, output_format: "png" },
        input.signal,
        input.references.length < 4 ? 2500 : 5000,
      );
      const url = out.images?.[0]?.url;
      if (!url) throw new ProviderError("no_output", "FAL no devolvió imagen.");
      return { image: await fetchBlob(url, input.signal), nativeAlpha: false };
    },
  };
}

export function falTools(key: string): ToolsProvider {
  const one = async (model: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    const out = await falQueue<{ image?: { url: string } }>(key, model, input, signal);
    if (!out.image?.url) throw new ProviderError("no_output", "FAL no devolvió resultado.");
    return fetchBlob(out.image.url, signal);
  };
  return {
    id: "fal",
    async vectorize(image, signal) {
      const svg = await one(FAL_MODELS.vectorize, { image_url: await blobToDataURL(image) }, signal);
      return svg.text();
    },
    async upscale(image, signal) {
      return one(FAL_MODELS.upscale, { image_url: await blobToDataURL(image) }, signal);
    },
    async cutout(image, signal) {
      return one(
        FAL_MODELS.cutout,
        {
          image_url: await blobToDataURL(image),
          model: "General Use (Heavy)",
          operating_resolution: "2048x2048",
          refine_foreground: true,
          output_format: "png",
        },
        signal,
      );
    },
  };
}
