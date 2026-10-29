// Upscaler: ×2 o ×4, con IA (re-render fiel) o clásico (local / FAL), conservando la transparencia.
import { singleTool } from "../app/single";
import { chips } from "../app/ui";
import { blobToCanvas, canvasToBlob, makeCanvas } from "../core/image";
import { imageSize, makeImage, upscaleClassic } from "../core/imaging";
import { aiUpscalePrompt } from "../core/tool-prompts";

/** Lleva cualquier resultado al tamaño exacto pedido (original × factor). */
async function toExact(b: Blob, width: number, height: number): Promise<Blob> {
  const src = await blobToCanvas(b);
  if (src.width === width && src.height === height) return b;
  const [c, ctx] = makeCanvas(width, height);
  ctx.drawImage(src, 0, 0, width, height);
  return canvasToBlob(c);
}

export const mount = singleTool({
  id: "upscaler",
  dropTitle: "Soltá la imagen a ampliar",
  dropHint: "Fotos, artes o logos · también Ctrl+V",
  defaults: { factor: "2", method: "ia" },
  options: (s) => `
    <span class="label">Tamaño</span>${chips("factor", [{ id: "2", label: "×2" }, { id: "4", label: "×4" }], s.opts.factor)}
    <span class="label">Método</span>${chips("method", [{ id: "ia", label: "Con IA" }, { id: "clasico", label: "Clásico" }], s.opts.method)}
    <p class="hint">${s.opts.method === "ia" ? "La IA redibuja con más detalle y bordes nítidos, sin cambiar el contenido." : "Ampliación sin IA: rápida y sin costo (o FAL Crisp si está configurado)."}</p>`,
  action: (s) => `Ampliar ×${s.opts.factor}`,
  workingText: (s) => (s.opts.method === "ia" ? "Redibujando en alta resolución…" : "Ampliando…"),
  async run(input, s, ctx) {
    const factor = Number(s.opts.factor);
    const { width, height } = await imageSize(input.blob);
    const target = { width: Math.min(width * factor, 12000), height: Math.min(height * factor, 12000) };
    let out: Blob;
    if (s.opts.method === "ia") {
      out = await makeImage(ctx.settings(), { tool: "upscaler", operation: "ampliar", prompt: aiUpscalePrompt(), refs: [input.blob], ratio: width / height });
    } else {
      out = await upscaleClassic(ctx.settings(), input.blob);
    }
    return {
      blob: await toExact(out, target.width, target.height),
      name: `${input.name} ×${factor}`,
      caption: s.opts.method === "ia" ? "IA" : "clásico",
    };
  },
});
