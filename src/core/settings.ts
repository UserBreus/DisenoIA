// Configuración de proveedores. Las claves quedan sólo en este navegador (localStorage).

export type AnalysisProviderId = "codex" | "demo" | "gemini" | "openai" | "anthropic";
export type ImageProviderId = "codex" | "demo" | "gemini" | "openai" | "fal";
export type ToolsProviderId = "local" | "fal";

export interface Settings {
  analysis: { provider: AnalysisProviderId; model: string; baseUrl: string };
  image: { provider: ImageProviderId; model: string; quality: "low" | "medium" | "high" };
  tools: { provider: ToolsProviderId };
  /** Puente local hacia Codex CLI (cuenta de ChatGPT de esta PC). */
  codex: { url: string };
  keys: { gemini: string; openai: string; anthropic: string; fal: string };
}

export const DEFAULT_MODELS = {
  analysis: {
    codex: "",
    demo: "demo",
    gemini: "gemini-2.5-flash",
    openai: "gpt-4.1-mini",
    anthropic: "claude-sonnet-5-5",
  },
  image: {
    codex: "",
    demo: "demo",
    gemini: "gemini-2.5-flash-image",
    openai: "gpt-image-1",
    fal: "fal-ai/nano-banana/edit",
  },
} as const;

export const FAL_MODELS = {
  vectorize: "fal-ai/recraft/vectorize",
  upscale: "fal-ai/recraft/upscale/crisp",
  cutout: "fal-ai/birefnet/v2",
};

const KEY = "disenoia.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  analysis: { provider: "codex", model: DEFAULT_MODELS.analysis.codex, baseUrl: "https://api.openai.com/v1" },
  image: { provider: "codex", model: DEFAULT_MODELS.image.codex, quality: "high" },
  tools: { provider: "local" },
  codex: { url: "" },
  keys: { gemini: "", openai: "", anthropic: "", fal: "" },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      analysis: { ...DEFAULT_SETTINGS.analysis, ...s.analysis },
      image: { ...DEFAULT_SETTINGS.image, ...s.image },
      tools: { ...DEFAULT_SETTINGS.tools, ...s.tools },
      codex: { ...DEFAULT_SETTINGS.codex, ...s.codex },
      keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * URL del puente de Codex. Vacía = automática: proxy de Vite en desarrollo, mismo origen si el
 * puente sirve la app (http://127.0.0.1:8787), o el puerto por defecto si se abrió con file://.
 */
export function codexUrl(s: Settings): string {
  const url = s.codex.url.trim();
  if (url) return url.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/codex";
  return location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:8787";
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento bloqueado: la configuración dura sólo esta sesión */
  }
}
