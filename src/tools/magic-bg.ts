// Fondo mágico: quitar el fondo (IA o rápido) o reemplazarlo por una escena nueva generada con IA.
import { singleTool } from "../app/single";
import { chips, esc } from "../app/ui";
import { cutoutImage, imageSize, makeImage } from "../core/imaging";
import { magicBackgroundPrompt } from "../core/tool-prompts";

const SCENES = [
  "estudio fotográfico blanco con sombra suave",
  "estudio negro con luz de borde",
  "superficie de mármol claro",
  "calle urbana al atardecer, desenfocada",
  "degradado suave cian, magenta y amarillo",
];

export const mount = singleTool({
  id: "fondo",
  dropTitle: "Soltá la imagen",
  dropHint: "Productos, personas, mascotas o artes · también Ctrl+V",
  defaults: { mode: "quitar", method: "ia", scene: "" },
  options: (s) => `
    ${chips("mode", [{ id: "quitar", label: "Quitar fondo" }, { id: "nuevo", label: "Fondo nuevo" }], s.opts.mode)}
    ${
      s.opts.mode === "quitar"
        ? `<span class="label">Método</span>${chips("method", [{ id: "ia", label: "Con IA" }, { id: "rapido", label: "Rápido" }], s.opts.method)}
           <p class="hint">${s.opts.method === "ia" ? "La IA separa el sujeto con precisión, incluso con fondos complejos." : "Recorte inmediato en el navegador (o BiRefNet en FAL): ideal para fondos lisos."}</p>`
        : `<label class="field">Escena<textarea data-opt="scene" rows="3" placeholder="Ej.: vidriera de tienda con luz cálida">${esc(s.opts.scene)}</textarea></label>
           <div class="suggest">${SCENES.map((x) => `<button type="button" class="chip" data-chip="scene" data-value="${esc(x)}">${esc(x)}</button>`).join("")}</div>`
    }`,
  action: (s) => (s.opts.mode === "quitar" ? "Quitar fondo" : "Generar fondo"),
  workingText: (s) => (s.opts.mode === "quitar" ? "Separando el sujeto del fondo…" : "Generando la escena nueva…"),
  check: (s) => (s.opts.mode === "nuevo" && !s.opts.scene.trim() ? "Describí la escena del fondo nuevo." : null),
  async run(input, s, ctx) {
    const { width, height } = await imageSize(input.blob);
    if (s.opts.mode === "nuevo") {
      const blob = await makeImage(ctx.settings(), {
        tool: "fondo",
        operation: "fondo",
        prompt: magicBackgroundPrompt(s.opts.scene),
        refs: [input.blob],
        ratio: width / height,
      });
      return { blob, name: `${input.name} · ${s.opts.scene.slice(0, 30)}`, caption: "fondo nuevo" };
    }
    const blob =
      s.opts.method === "ia"
        ? await makeImage(ctx.settings(), {
            tool: "fondo",
            operation: "recortar",
            prompt:
              "Edit the provided image. Keep the main subject EXACTLY as it is (shape, colors, details, text, position and scale) and remove everything else, so only the subject remains.",
            refs: [input.blob],
            ratio: width / height,
            transparent: true,
          })
        : await cutoutImage(ctx.settings(), input.blob);
    return { blob, name: `${input.name} sin fondo`, caption: s.opts.method === "ia" ? "IA" : "rápido" };
  },
});
