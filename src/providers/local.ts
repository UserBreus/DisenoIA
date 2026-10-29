// Herramientas locales, sin red ni claves: vectorizado, ampliación y recorte de fondo en el navegador.
import { blobToCanvas, canvasToBlob, getImageData, imageDataToCanvas, makeCanvas } from "../core/image";
import { removeBorderBackground, sharpen } from "../core/matte";
import { vectorizeArtwork } from "../core/vector/pipeline";
import type { ToolsProvider, VectorOptions } from "./types";

const MAX_SIDE = 8192;

export function localTools(): ToolsProvider {
  return {
    id: "local",
    async vectorize(image, _signal, options: VectorOptions = {}) {
      // Separación por color: pocos colores dominantes, una imagen de un solo color por cada uno.
      const { svg } = await vectorizeArtwork(image, { maxColors: options.colors ?? 8, detail: 1 - (options.simplify ?? 0.1) });
      return svg;
    },
    async upscale(image) {
      let c = await blobToCanvas(image);
      // Dos pasadas de 2x con suavizado alto + enfoque leve (mejor que una sola de 4x).
      for (let i = 0; i < 2 && Math.max(c.width, c.height) * 2 <= MAX_SIDE; i++) {
        const [n, ctx] = makeCanvas(c.width * 2, c.height * 2);
        ctx.drawImage(c, 0, 0, n.width, n.height);
        c = n;
      }
      return canvasToBlob(imageDataToCanvas(sharpen(getImageData(c))));
    },
    async cutout(image) {
      const c = await blobToCanvas(image);
      return canvasToBlob(imageDataToCanvas(removeBorderBackground(getImageData(c))));
    },
  };
}

