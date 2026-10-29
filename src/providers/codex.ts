// Codex local: usa la cuenta de ChatGPT de esta PC a través del puente (bridge/codex-bridge.mjs). Sin API key.
import { blobToDataURL, dataUrlToBlob } from "../core/image";
import { ProviderError, type FailureCode } from "../core/types";
import type { AnalysisProvider, ImageEditProvider } from "./types";

const CODEX_TIMEOUT_MS = 15 * 60_000; // incluye la espera en la cola del puente

const OFFLINE = "No responde el puente de Codex. Ejecutá «npm run codex» en esta PC.";

async function call<T>(base: string, route: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), CODEX_TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort("cancelled"));
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // El puente responde { error: { code, message } } con el código ya normalizado.
      const err = json?.error ?? {};
      throw new ProviderError((err.code as FailureCode) || "gateway", `Codex: ${err.message ?? `HTTP ${res.status}`}`, res.status);
    }
    return json as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (ctrl.signal.aborted) {
      const cancelled = ctrl.signal.reason === "cancelled";
      throw new ProviderError(cancelled ? "cancelled" : "timeout", cancelled ? "Operación cancelada." : "Codex tardó demasiado.");
    }
    throw new ProviderError("gateway", OFFLINE);
  } finally {
    clearTimeout(timer);
  }
}

export async function codexHealth(base: string): Promise<{ ok: boolean; version?: string; login?: string; error?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/health`);
    return await r.json();
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

export function codexAnalysis(base: string, model: string): AnalysisProvider {
  return {
    id: "codex",
    model: model || "codex",
    async ask(input) {
      const out = await call<{ text?: string }>(base, "/analyze", { image: input.image, system: input.system, prompt: input.prompt, model }, input.signal);
      if (!out.text) throw new ProviderError("no_output", "Codex no devolvió contenido.");
      return out.text;
    },
  };
}

export function codexImage(base: string, model: string): ImageEditProvider {
  return {
    id: "codex",
    model: model || "codex",
    transparency: false,
    async recreate(input) {
      const references = await Promise.all(input.references.map(blobToDataURL));
      const out = await call<{ image?: string; error?: { code: FailureCode; message: string } }>(
        base,
        "/recreate",
        { prompt: input.prompt, references, ratio: input.ratio, background: input.background, model },
        input.signal,
      );
      if (!out.image) throw new ProviderError("no_output", "Codex no generó imagen.");
      return { image: await dataUrlToBlob(out.image), nativeAlpha: false };
    },
  };
}
