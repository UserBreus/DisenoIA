// Diálogo de ajustes: proveedores, modelos y claves (guardadas sólo en este navegador).
import { DEFAULT_MODELS, codexUrl, saveSettings, type Settings } from "../core/settings";
import { codexHealth } from "../providers/codex";
import { esc } from "./dom";

const opt = (value: string, label: string, current: string) =>
  `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;

export function settingsHtml(s: Settings): string {
  return `
<form method="dialog" class="settings" id="settings-form">
  <header><h2>Ajustes</h2><button class="icon" value="cancel" aria-label="Cerrar">✕</button></header>

  <p class="note">Las claves se guardan <b>sólo en este navegador</b> y se envían directo a cada proveedor. Usá claves con límite de gasto.
  <b>Codex</b> usa la cuenta de ChatGPT de esta PC (sin API): iniciá el puente con <code>npm run codex</code>. El modo <b>Demo</b> funciona sin nada.</p>

  <fieldset>
    <legend>Codex local</legend>
    <label>URL del puente <input name="codex.url" value="${esc(s.codex.url)}" autocomplete="off" placeholder="automática" /></label>
    <label>Estado <span class="codex-status" id="codex-status">sin comprobar</span>
      <button type="button" class="sm" id="codex-test">Probar conexión</button></label>
  </fieldset>

  <fieldset>
    <legend>1 · Análisis de la foto</legend>
    <label>Proveedor
      <select name="analysis.provider">
        ${opt("codex", "Codex (cuenta de esta PC)", s.analysis.provider)}
        ${opt("demo", "Demo (sin IA)", s.analysis.provider)}
        ${opt("gemini", "Google Gemini", s.analysis.provider)}
        ${opt("openai", "OpenAI o compatible", s.analysis.provider)}
        ${opt("anthropic", "Anthropic Claude", s.analysis.provider)}
      </select>
    </label>
    <label>Modelo <input name="analysis.model" value="${esc(s.analysis.model)}" autocomplete="off" placeholder="por defecto" /></label>
    <label class="${s.analysis.provider === "openai" ? "" : "hidden"}" data-show="openai">URL base compatible
      <input name="analysis.baseUrl" value="${esc(s.analysis.baseUrl)}" autocomplete="off" />
    </label>
  </fieldset>

  <fieldset>
    <legend>2 · Recreación de diseños</legend>
    <label>Proveedor
      <select name="image.provider">
        ${opt("codex", "Codex (cuenta de esta PC)", s.image.provider)}
        ${opt("demo", "Demo (limpieza local)", s.image.provider)}
        ${opt("gemini", "Google Gemini (imagen)", s.image.provider)}
        ${opt("openai", "OpenAI Images", s.image.provider)}
        ${opt("fal", "FAL", s.image.provider)}
      </select>
    </label>
    <label>Modelo <input name="image.model" value="${esc(s.image.model)}" autocomplete="off" placeholder="por defecto" /></label>
    <label>Calidad
      <select name="image.quality">
        ${opt("low", "Baja", s.image.quality)}${opt("medium", "Media", s.image.quality)}${opt("high", "Alta", s.image.quality)}
      </select>
    </label>
  </fieldset>

  <fieldset>
    <legend>3 · Ampliar, vectorizar y quitar fondo</legend>
    <label>Proveedor
      <select name="tools.provider">
        ${opt("local", "Local en el navegador (gratis)", s.tools.provider)}
        ${opt("fal", "FAL (Recraft + BiRefNet)", s.tools.provider)}
      </select>
    </label>
  </fieldset>

  <fieldset>
    <legend>Claves de API</legend>
    ${(["gemini", "openai", "anthropic", "fal"] as const)
      .map(
        (k) => `<label>${k === "fal" ? "FAL" : k[0].toUpperCase() + k.slice(1)}
      <input type="password" name="keys.${k}" value="${esc(s.keys[k])}" autocomplete="off" spellcheck="false" placeholder="sin configurar" /></label>`,
      )
      .join("")}
  </fieldset>

  <footer><button value="cancel" class="ghost">Cancelar</button><button value="save" class="primary" id="settings-save">Guardar</button></footer>
</form>`;
}

/** Conecta el formulario: cambia el modelo por defecto al cambiar de proveedor y guarda. */
export function bindSettings(dialog: HTMLDialogElement, s: Settings, onSave: (s: Settings) => void) {
  const form = dialog.querySelector<HTMLFormElement>("#settings-form")!;
  form.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.name === "analysis.provider") {
      (form.elements.namedItem("analysis.model") as HTMLInputElement).value = DEFAULT_MODELS.analysis[t.value as keyof typeof DEFAULT_MODELS.analysis];
      form.querySelector("[data-show=openai]")!.classList.toggle("hidden", t.value !== "openai");
    }
    if (t.name === "image.provider") {
      (form.elements.namedItem("image.model") as HTMLInputElement).value = DEFAULT_MODELS.image[t.value as keyof typeof DEFAULT_MODELS.image];
    }
  });
  form.querySelector("#codex-test")!.addEventListener("click", async () => {
    const out = form.querySelector<HTMLElement>("#codex-status")!;
    out.textContent = "comprobando…";
    const url = (form.elements.namedItem("codex.url") as HTMLInputElement).value;
    const h = await codexHealth(codexUrl({ ...s, codex: { url } }));
    out.textContent = h.ok ? `✓ ${h.version ?? "codex"} · ${h.login ?? ""}` : `✕ ${h.error ?? h.login ?? "sin sesión"}`;
    out.className = `codex-status ${h.ok ? "ok" : "bad"}`;
  });
  form.querySelector("#settings-save")!.addEventListener("click", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const next: Settings = structuredClone(s);
    for (const [k, v] of data.entries()) {
      const [group, field] = k.split(".") as [keyof Settings, string];
      (next[group] as unknown as Record<string, string>)[field] = String(v).trim();
    }
    saveSettings(next);
    onSave(next);
    dialog.close();
  });
}
