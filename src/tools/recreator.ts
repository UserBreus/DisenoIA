// Recreador: limpiar y redibujar un arte, crear una variación o pasarlo a otro estilo.
import { singleTool } from "../app/single";
import { chips, esc } from "../app/ui";
import { imageSize, makeImage } from "../core/imaging";
import { STYLES, recreatorPrompt, type RecreateMode, type StyleId } from "../core/tool-prompts";

const MODES = [
  { id: "limpiar", label: "Limpiar y redibujar" },
  { id: "variacion", label: "Variación" },
  { id: "estilo", label: "Cambiar estilo" },
];

export const mount = singleTool({
  id: "recreador",
  dropTitle: "Soltá el arte a recrear",
  dropHint: "Capturas, fotos borrosas o artes de baja calidad · también Ctrl+V",
  defaults: { mode: "limpiar", style: "vector", notes: "", transparent: "false" },
  options: (s) => `
    ${chips("mode", MODES, s.opts.mode)}
    ${s.opts.mode === "estilo" ? `<span class="label">Estilo</span>${chips("style", STYLES.filter((x) => x.id !== "libre"), s.opts.style)}` : ""}
    <label class="field">Indicaciones (opcional)<textarea data-opt="notes" rows="3" placeholder="Ej.: el texto dice “CLUB 1990”, mantener el azul oscuro">${esc(s.opts.notes)}</textarea></label>
    <label class="toggle"><input type="checkbox" data-opt="transparent" ${s.opts.transparent === "true" ? "checked" : ""}/> <span>Fondo transparente</span></label>`,
  action: (s) => (s.opts.mode === "limpiar" ? "Recrear limpio" : s.opts.mode === "variacion" ? "Crear variación" : "Cambiar estilo"),
  workingText: () => "Recreando el arte…",
  async run(input, s, ctx) {
    const { width, height } = await imageSize(input.blob);
    const mode = s.opts.mode as RecreateMode;
    const blob = await makeImage(ctx.settings(), {
      tool: "recreador",
      operation: "editar",
      prompt: recreatorPrompt(mode, s.opts.notes, s.opts.style as StyleId),
      refs: [input.blob],
      ratio: width / height,
      transparent: s.opts.transparent === "true",
    });
    const label = MODES.find((m) => m.id === mode)!.label.toLowerCase();
    return { blob, name: `${input.name} · ${label}`, caption: mode === "estilo" ? STYLES.find((x) => x.id === s.opts.style)?.label : label, meta: { mode } };
  },
});
