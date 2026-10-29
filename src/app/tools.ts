// Registro de herramientas. Cada una se carga al abrirla (import dinámico) y se monta en la vista.
import type { Asset } from "../core/store";
import type { Settings } from "../core/settings";

export type Ink = "c" | "m" | "y";

/** Imagen que una herramienta le pasa a otra ("Enviar a…"). */
export interface Handoff {
  blob: Blob;
  name: string;
  svg?: string;
}

export interface ToolContext {
  settings(): Settings;
  navigate(id: string, handoff?: Handoff): void;
  /** Devuelve (y consume) la imagen enviada desde otra herramienta. */
  takeHandoff(): Handoff | null;
  /** Guarda un resultado en la biblioteca y lo deja disponible para "Enviar a…". */
  keep(a: Omit<Asset, "id" | "createdAt" | "width" | "height"> & { width?: number; height?: number }): Promise<Asset>;
  openSettings(): void;
  /** Imagen enviada desde otra herramienta cuando ésta ya está abierta (sigue viva en segundo plano). */
  onReceive(fn: (h: Handoff) => void): void;
  /** Se llama cada vez que la herramienta vuelve a mostrarse. */
  onShow(fn: () => void): void;
}

export type Mount = (root: HTMLElement, ctx: ToolContext) => void | (() => void);

export interface ToolDef {
  id: string;
  label: string;
  /** Descripción corta para el riel y la cabecera. */
  desc: string;
  icon: string;
  ink: Ink;
  /** Puede recibir una imagen desde otra herramienta. */
  accepts: boolean;
  load: () => Promise<{ mount: Mount }>;
}

export const TOOLS: ToolDef[] = [
  { id: "extractor", label: "Extractor", desc: "Separa cada logo, texto y fondo de una foto", icon: "extractor", ink: "c", accepts: true, load: () => import("../tools/extractor") },
  { id: "creador", label: "Creador", desc: "De la idea a 2 modelos de producto", icon: "creador", ink: "m", accepts: false, load: () => import("../tools/creator") },
  { id: "generador", label: "Generador", desc: "Imágenes en cualquier estilo", icon: "generador", ink: "y", accepts: false, load: () => import("../tools/generator") },
  { id: "vectorizador", label: "Vectorizador", desc: "SVG, EPS y PDF con mejora por IA", icon: "vectorizador", ink: "c", accepts: true, load: () => import("../tools/vectorizer") },
  { id: "mockup", label: "Mockup 3D", desc: "Tu estampa en 3D, foto y video 360°", icon: "mockup", ink: "m", accepts: true, load: () => import("../tools/mockup") },
  { id: "fondo", label: "Fondo mágico", desc: "Quita el fondo o crea uno nuevo", icon: "fondo", ink: "y", accepts: true, load: () => import("../tools/magic-bg") },
  { id: "recreador", label: "Recreador", desc: "Limpia, varía o cambia el estilo de un arte", icon: "recreador", ink: "c", accepts: true, load: () => import("../tools/recreator") },
  { id: "upscaler", label: "Upscaler", desc: "Amplía ×2 o ×4 con o sin IA", icon: "upscaler", ink: "m", accepts: true, load: () => import("../tools/upscaler") },
  { id: "fuentes", label: "Creador de fuentes", desc: "Letterings con IA y fondo transparente", icon: "fuentes", ink: "y", accepts: false, load: () => import("../tools/font-creator") },
  { id: "buscador", label: "Buscador de fuentes", desc: "Identifica la tipografía de una imagen", icon: "buscador", ink: "c", accepts: true, load: () => import("../tools/font-finder") },
  { id: "biblioteca", label: "Biblioteca", desc: "Todo lo que generaste, en un lugar", icon: "biblioteca", ink: "m", accepts: false, load: () => import("../tools/library") },
];

export const HOME: ToolDef = { id: "inicio", label: "Inicio", desc: "Todas las herramientas", icon: "inicio", ink: "c", accepts: false, load: () => import("../tools/home") };

export const toolById = (id: string) => TOOLS.find((t) => t.id === id) ?? (id === HOME.id ? HOME : undefined);

/** Herramientas a las que se puede enviar una imagen. */
export const SEND_TARGETS = TOOLS.filter((t) => t.accepts);
