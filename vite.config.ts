import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Genera un único dist/index.html autocontenido: se abre con doble clic o se sube a cualquier hosting estático.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  server: {
    // En desarrollo, /codex va al puente local de Codex (mismo origen: sin CORS).
    proxy: {
      "/codex": {
        target: "http://127.0.0.1:8787",
        rewrite: (p) => p.replace(/^\/codex/, ""),
        timeout: 900_000,
        proxyTimeout: 900_000,
      },
    },
  },
  build: {
    target: "es2022",
    cssMinify: true,
    reportCompressedSize: true,
  },
});
