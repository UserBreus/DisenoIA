#!/usr/bin/env node
// Puente local DiseñoIA → Codex CLI (cuenta de ChatGPT de esta PC, sin API key).
// El navegador no puede ejecutar programas: este servidor mínimo (sin dependencias) recibe
// las solicitudes de la app en 127.0.0.1 y las ejecuta con `codex exec`.
//
//   node bridge/codex-bridge.mjs            (o: npm run codex)
//
// Variables opcionales: PORT (8787), CODEX_BIN, CODEX_HOME, CODEX_CONCURRENCY (2),
// CODEX_ANALYSIS_MODEL / CODEX_IMAGE_MODEL (gpt-6-luna), CODEX_FULL_CONFIG=1 (usa tu config.toml completa),
// BRIDGE_TOKEN (exige cabecera x-bridge-token), ALLOW_FILE_ORIGIN=1 (permite abrir dist/index.html con file://).
//
// Velocidad: casi todo el tiempo es el turno del modelo. Por eso se usa un modelo liviano, sin la
// config global (MCP, memorias, skills, plugins) ni herramientas, y se responde apenas termina el turno.

import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const MAX_CONCURRENT = Math.max(1, Number(process.env.CODEX_CONCURRENCY || 2));
const TOKEN = process.env.BRIDGE_TOKEN || "";
const ANALYZE_TIMEOUT = 240_000;
const RECREATE_TIMEOUT = 600_000;
const MAX_BODY = 80 * 1024 * 1024;
const APP_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");
// El análisis usa el modelo grande: el liviano leía mal textos ("la IA" → "la 14") y escenas complejas.
const ANALYSIS_MODEL = process.env.CODEX_ANALYSIS_MODEL || "gpt-6.1-sol";
const IMAGE_MODEL = process.env.CODEX_IMAGE_MODEL || "gpt-6-luna";
const FULL_CONFIG = process.env.CODEX_FULL_CONFIG === "1";

// Instrucciones base cortas en lugar del prompt de agente de programación de Codex.
const INSTRUCTIONS_FILE = path.join(os.tmpdir(), "disenoia-codex-instructions.txt");
fs.writeFileSync(
  INSTRUCTIONS_FILE,
  "You are a precise production-artwork assistant. Follow the user instructions exactly. Do not explore files or run commands.\n",
);
// Herramientas que este uso no necesita: menos tokens por solicitud y ningún desvío del modelo.
const UNUSED_FEATURES = [
  "shell_tool", "unified_exec", "multi_agent", "plugins", "apps", "memories", "skill_search", "browser_use",
  "browser_use_external", "computer_use", "goals", "tool_suggest", "collaboration_modes", "view_image",
  "sleep_tool", "in_app_browser", "hooks",
];

// ---------- localizar codex ----------

function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8" });
  if (which.status === 0) return which.stdout.split(/\r?\n/)[0].trim();
  if (process.platform === "win32") {
    // App de escritorio de Codex (Microsoft Store): el alias apunta a la carpeta versionada del paquete.
    const aliases = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps");
    try {
      for (const dir of fs.readdirSync(aliases).filter((d) => d.startsWith("OpenAI.Codex_"))) {
        for (const exe of fs.readdirSync(path.join(aliases, dir))) {
          try {
            const link = path.join(aliases, dir, exe);
            // realpath falla con EACCES en paquetes de la Store; readlink sí devuelve el destino.
            let real;
            try {
              real = fs.readlinkSync(link);
            } catch {
              real = fs.realpathSync(link);
            }
            const resources = real.slice(0, real.toLowerCase().indexOf(`${path.sep}resources${path.sep}`) + 11);
            const candidate = path.join(resources, "codex.exe");
            if (fs.existsSync(candidate)) return candidate;
          } catch {
            /* alias roto */
          }
        }
      }
    } catch {
      /* sin alias */
    }
  }
  if (process.platform === "darwin" && fs.existsSync("/Applications/Codex.app/Contents/Resources/codex")) {
    return "/Applications/Codex.app/Contents/Resources/codex";
  }
  return null;
}

const CODEX = findCodex();

// ---------- ejecución ----------

let running = 0;
const waiting = [];
const acquire = () =>
  running < MAX_CONCURRENT ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(() => (running++, r())));
const release = () => {
  running--;
  waiting.shift()?.();
};

/** Ejecuta codex y responde apenas llega el fin del turno (Codex tarda ~2 s más en cerrarse solo). */
function runCodex(args, stdin, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      done = true;
      reject(Object.assign(new Error("Codex tardó demasiado."), { code: "timeout" }));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (/"type":"turn\.(completed|failed)"/.test(d.toString())) {
        // Margen breve para que se termine de escribir -o out.txt antes de cortar.
        setTimeout(() => {
          finish(/"type":"turn\.failed"/.test(stdout) ? 1 : 0);
          child.kill();
        }, 150);
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!done) reject(e);
      done = true;
    });
    child.on("close", (code) => finish(code));
    child.stdin.end(stdin);
  });
}

/** Codex puede seguir cerrándose y retener la carpeta: se borra en segundo plano con reintentos. */
function cleanup(dir) {
  fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }, () => {});
}

const FAILURE_CODES = new Set(["safety", "rate_limited", "no_output", "timeout", "missing_reference", "provider_credits", "auth", "gateway", "cancelled", "unknown"]);

function writeDataUrl(dir, name, dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw Object.assign(new Error("Imagen inválida."), { code: "missing_reference", status: 400 });
  const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
  const file = path.join(dir, `${name}.${ext}`);
  fs.writeFileSync(file, Buffer.from(m[2], "base64"));
  return file;
}

const events = (stdout) =>
  stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

function codexFailure(result) {
  const evs = events(result.stdout);
  const err = evs.find((e) => e.type === "error" || e.type === "turn.failed");
  const msg = err?.message || err?.error?.message || result.stderr.split(/\r?\n/).filter((l) => /error/i.test(l)).slice(-2).join(" ") || `codex terminó con código ${result.code}`;
  const lower = msg.toLowerCase();
  const code = /usage limit|rate limit|429/.test(lower) ? "rate_limited" : /login|auth|401|unauthorized/.test(lower) ? "auth" : /safety|policy|blocked/.test(lower) ? "safety" : "gateway";
  return Object.assign(new Error(msg.slice(0, 500)), { code });
}

const baseArgs = (model) => [
  "exec",
  "--skip-git-repo-check",
  "--color",
  "never",
  "--json",
  "-s",
  "read-only",
  "-c",
  'model_reasoning_effort="low"',
  ...(FULL_CONFIG
    ? []
    : [
        "--ignore-user-config", // la sesión de ChatGPT se sigue leyendo de CODEX_HOME
        "-c",
        `model_instructions_file=${JSON.stringify(INSTRUCTIONS_FILE)}`,
        ...UNUSED_FEATURES.flatMap((f) => ["--disable", f]),
      ]),
  ...(model ? ["-m", model] : []),
];

async function analyze(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disenoia-"));
  try {
    const img = writeDataUrl(dir, "foto", body.image);
    const out = path.join(dir, "out.txt");
    const prompt = `${body.system}\n\n${body.prompt}\n\nDo not run commands or use tools. Answer with the JSON object only.`;
    const args = [...baseArgs(body.model || ANALYSIS_MODEL), "--ephemeral", "--disable", "image_generation", "-C", dir, "-o", out, "-i", img, "-"];
    const result = await runCodex(args, prompt, dir, ANALYZE_TIMEOUT);
    // Respaldo: si se cortó antes de escribir out.txt, el texto también viene en los eventos.
    const fromEvents = events(result.stdout).filter((e) => e.item?.type === "agent_message").pop()?.item.text ?? "";
    const text = (fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "") || fromEvents.trim();
    if (result.code !== 0 && !text) throw codexFailure(result);
    if (!text) throw Object.assign(new Error("Codex no devolvió respuesta."), { code: "no_output" });
    return { text };
  } finally {
    cleanup(dir);
  }
}

function newestPng(dir, since) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 1000)
      .sort((a, b) => b.t - a.t)[0]?.f;
  } catch {
    return undefined;
  }
}

/** Archivo de sesión de Codex para un hilo (sirve para auditar la llamada al generador). */
function findRollout(thread) {
  const base = path.join(CODEX_HOME, "sessions");
  for (const offset of [0, -1]) {
    const d = new Date(Date.now() + offset * 86_400_000);
    const dir = path.join(base, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    try {
      const f = fs.readdirSync(dir).find((n) => n.endsWith(`${thread}.jsonl`));
      if (f) return path.join(dir, f);
    } catch {
      /* carpeta inexistente */
    }
  }
  return undefined;
}

/** Cuántas imágenes adjuntas le pasó el agente al generador (0 = generó sólo desde texto). */
function imagesPassed(thread) {
  const file = thread && findRollout(thread);
  if (!file) return null;
  // En el registro la llamada aparece como texto JS escapado: num_last_images_to_include:1
  const m = /num_last_images_to_include\\?"?\s*:\s*(\d+)/.exec(fs.readFileSync(file, "utf8"));
  return m ? Number(m[1]) : 0;
}

function recreatePrompt(body, count, strict) {
  const ratio = Number(body.ratio) > 0 ? Number(body.ratio).toFixed(2) : "1";
  const head = count
    ? [
        `You have ${count} attached image${count > 1 ? "s" : ""}. Call your image generation tool exactly once, in EDIT mode, with these arguments:`,
        `- num_last_images_to_include: ${count}  (REQUIRED — the generator must receive the attached image${count > 1 ? "s" : ""}; without them it would invent content)`,
      ]
    : ["Call your image generation tool exactly once to GENERATE a new image (there are no input images), with this argument:"];
  return [
    ...head,
    "- prompt: the text inside <prompt>…</prompt>, copied VERBATIM. Do not summarize, translate, reword or add descriptions of your own.",
    `Preferred aspect ratio (width/height): ${ratio}.`,
    strict ? "IMPORTANT: a previous attempt forgot num_last_images_to_include. It is mandatory." : "",
    "Do not run commands or write files. When the image is generated reply only: DONE",
    "",
    "<prompt>",
    String(body.prompt ?? ""),
    "</prompt>",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function recreateOnce(body, files, dir, model, strict) {
  const started = Date.now();
  const args = [...baseArgs(model), "-C", dir, ...files.flatMap((f) => ["-i", f]), "-"];
  const result = await runCodex(args, recreatePrompt(body, files.length, strict), dir, RECREATE_TIMEOUT);
  const thread = events(result.stdout).find((e) => e.type === "thread.started")?.thread_id;
  const root = path.join(CODEX_HOME, "generated_images");
  let file = thread ? newestPng(path.join(root, thread), started) : undefined;
  if (!file) {
    // Respaldo: la imagen más reciente creada durante esta ejecución.
    for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      const f = newestPng(path.join(root, d), started);
      if (f && (!file || fs.statSync(f).mtimeMs > fs.statSync(file).mtimeMs)) file = f;
    }
  }
  if (!file) {
    if (result.code !== 0) throw codexFailure(result);
    throw Object.assign(new Error("Codex no generó imagen."), { code: "no_output" });
  }
  return { file, thread, passed: imagesPassed(thread) };
}

async function recreate(body) {
  const refs = Array.isArray(body.references) ? body.references : [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disenoia-"));
  const started = Date.now();
  try {
    const files = refs.map((r, i) => writeDataUrl(dir, `ref-${i + 1}`, r));
    let out = await recreateOnce(body, files, dir, body.model || IMAGE_MODEL, false);
    if (files.length && out.passed === 0) {
      // El agente generó sin mirar la foto: el resultado sería inventado. Se reintenta con el modelo grande.
      console.warn(`[recreate] el generador no recibió las referencias (hilo ${out.thread}); reintento con ${ANALYSIS_MODEL}`);
      out = await recreateOnce(body, files, dir, ANALYSIS_MODEL, true);
    }
    const buf = fs.readFileSync(out.file);
    const mime = out.file.endsWith(".png") ? "image/png" : out.file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return {
      image: `data:${mime};base64,${buf.toString("base64")}`,
      thread: out.thread,
      referencesUsed: out.passed,
      ms: Date.now() - started,
    };
  } finally {
    cleanup(dir);
  }
}

function health() {
  if (!CODEX) return { ok: false, error: "No se encontró codex. Definí CODEX_BIN con la ruta a codex.exe." };
  const v = spawnSync(CODEX, ["--version"], { encoding: "utf8", windowsHide: true });
  const s = spawnSync(CODEX, ["login", "status"], { encoding: "utf8", windowsHide: true });
  const login = `${s.stdout}${s.stderr}`.trim().split(/\r?\n/)[0];
  return { ok: s.status === 0, version: v.stdout.trim(), login, concurrency: MAX_CONCURRENT, busy: running, queued: waiting.length };
}

// ---------- HTTP ----------

const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function allowed(origin) {
  if (!origin) return true; // herramientas locales (curl)
  if (origin === "null") return process.env.ALLOW_FILE_ORIGIN === "1";
  return ORIGIN_OK.test(origin);
}

function send(res, status, data, origin) {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(origin && allowed(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowed(origin)) return send(res, 403, { error: { code: "auth", message: "Origen no permitido." } });
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin || "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-bridge-token",
      "access-control-max-age": "600",
    });
    return res.end();
  }
  if (TOKEN && req.headers["x-bridge-token"] !== TOKEN) return send(res, 401, { error: { code: "auth", message: "Token del puente inválido." } }, origin);
  if (req.method === "GET" && req.url === "/health") return send(res, 200, health(), origin);
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    // Sirve la app compilada: abrí http://127.0.0.1:${PORT} y todo queda en el mismo origen.
    if (!fs.existsSync(APP_HTML)) return send(res, 404, { error: { code: "unknown", message: "Falta dist/index.html: ejecutá «npm run build»." } });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return fs.createReadStream(APP_HTML).pipe(res);
  }
  if (req.method !== "POST" || !["/analyze", "/recreate"].includes(req.url)) return send(res, 404, { error: { code: "unknown", message: "Ruta inexistente." } }, origin);
  if (!CODEX) return send(res, 500, { error: { code: "gateway", message: "No se encontró codex en esta PC." } }, origin);

  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return send(res, 413, { error: { code: "unknown", message: "Solicitud demasiado grande." } }, origin);
    chunks.push(c);
  }
  const id = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  await acquire();
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    console.log(`[${id}] ${req.url} iniciado (en curso ${running}/${MAX_CONCURRENT}, en espera ${waiting.length})`);
    const out = req.url === "/analyze" ? await analyze(body) : await recreate(body);
    console.log(`[${id}] ${req.url} OK en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    send(res, 200, out, origin);
  } catch (e) {
    console.error(`[${id}] ${req.url} ERROR: ${e.message}`);
    const code = FAILURE_CODES.has(e.code) ? e.code : "unknown";
    send(res, e.status || 502, { error: { code, message: e.message } }, origin);
  } finally {
    release();
  }
});

server.listen(PORT, HOST, () => {
  const h = health();
  console.log(`DiseñoIA · puente Codex en http://${HOST}:${PORT}${fs.existsSync(APP_HTML) ? " (abrí esa dirección para usar la app)" : ""}`);
  console.log(CODEX ? `codex: ${CODEX}\n${h.version} · ${h.login}` : "ATENCIÓN: no se encontró codex (definí CODEX_BIN).");
  console.log(`Modelos: análisis ${ANALYSIS_MODEL} · imagen ${IMAGE_MODEL}${FULL_CONFIG ? " · config completa" : " · modo liviano"} · concurrencia ${MAX_CONCURRENT}${TOKEN ? " · token requerido" : ""}`);
});
