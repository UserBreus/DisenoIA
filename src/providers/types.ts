export interface AnalysisInput {
  /** data URL JPEG/PNG. */
  image: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  /** Sólo lo usa el modo demo para devolver un ejemplo acorde a la tarea. */
  task?: "analysis" | "fonts";
}

export interface RecreationInput {
  prompt: string;
  /** Imágenes de referencia. Vacío = generación desde texto. */
  references: Blob[];
  /** Proporción ancho/alto deseada. */
  ratio: number;
  background: "transparent" | "opaque";
  signal?: AbortSignal;
}

export interface GeneratedImage {
  image: Blob;
  /** true si la imagen ya trae alfa real; false si hay que quitar el fondo clave. */
  nativeAlpha: boolean;
}

/** Modelo de visión: mira una imagen y responde texto (normalmente JSON). */
export interface AnalysisProvider {
  id: string;
  model: string;
  ask(input: AnalysisInput): Promise<string>;
}

export interface ImageEditProvider {
  id: string;
  model: string;
  /** Admite fondo transparente nativo. */
  transparency: boolean;
  recreate(input: RecreationInput): Promise<GeneratedImage>;
}

export interface ToolsProvider {
  id: string;
  vectorize(image: Blob, signal?: AbortSignal, options?: VectorOptions): Promise<string>;
  upscale(image: Blob, signal?: AbortSignal): Promise<Blob>;
  cutout(image: Blob, signal?: AbortSignal): Promise<Blob>;
}

export interface VectorOptions {
  /** Cantidad de colores del vector local (2–64). */
  colors?: number;
  /** 0 = máximo detalle, 1 = más simplificado. */
  simplify?: number;
}
