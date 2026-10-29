// Registro de proveedores: el producto no queda atado a ninguno.
import { codexUrl, type Settings } from "../core/settings";
import { ProviderError } from "../core/types";
import { anthropicAnalysis, demoAnalysis, geminiAnalysis, openaiAnalysis } from "./analysis";
import { codexAnalysis, codexImage } from "./codex";
import { falImage, falTools } from "./fal";
import { demoImage, geminiImage, openaiImage } from "./image";
import { localTools } from "./local";
import type { AnalysisProvider, ImageEditProvider, ToolsProvider } from "./types";

const need = (key: string, name: string) => {
  if (!key.trim()) throw new ProviderError("auth", `Falta la clave de ${name}. Abrí Ajustes.`);
  return key.trim();
};

export function analysisProvider(s: Settings): AnalysisProvider {
  const { provider, model, baseUrl } = s.analysis;
  switch (provider) {
    case "codex":
      return codexAnalysis(codexUrl(s), model);
    case "gemini":
      return geminiAnalysis(need(s.keys.gemini, "Gemini"), model);
    case "openai":
      return openaiAnalysis(need(s.keys.openai, "OpenAI"), model, baseUrl);
    case "anthropic":
      return anthropicAnalysis(need(s.keys.anthropic, "Anthropic"), model);
    default:
      return demoAnalysis();
  }
}

export function imageProvider(s: Settings): ImageEditProvider {
  const { provider, model, quality } = s.image;
  switch (provider) {
    case "codex":
      return codexImage(codexUrl(s), model);
    case "gemini":
      return geminiImage(need(s.keys.gemini, "Gemini"), model);
    case "openai":
      return openaiImage(need(s.keys.openai, "OpenAI"), model, quality);
    case "fal":
      return falImage(need(s.keys.fal, "FAL"), model);
    default:
      return demoImage();
  }
}

export function toolsProvider(s: Settings): ToolsProvider {
  return s.tools.provider === "fal" ? falTools(need(s.keys.fal, "FAL")) : localTools();
}

export type { AnalysisProvider, ImageEditProvider, ToolsProvider };
