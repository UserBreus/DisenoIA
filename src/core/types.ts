// Contratos centrales de DiseñoIA. Todo vive en el navegador: no hay backend.

export type View = "frente" | "espalda" | "lateral" | "detalle";
export type ObjectKind = "logo" | "texto" | "parche" | "etiqueta" | "figura";
export type ArtworkKind = ObjectKind | "fondo";
export type Behind = "prenda" | "estampa" | "propio";

/** Caja normalizada [x, y, ancho, alto], cada valor entre 0 y 1 sobre la foto original. */
export type Box = [number, number, number, number];

export interface Fragment {
  view: string;
  face: string;
  box_2d: Box;
  distortion: string[];
  fix: string[];
  missing: string[];
  issues: string[];
}

export interface BackgroundArtwork {
  surface: string;
  name: string | null;
  identity: string;
  plain: boolean;
  style: string[];
  colors: string[];
  mustInclude: string[];
  missing: string[];
  seams: Array<{ with: string; continuous: boolean }>;
  fragments: Fragment[];
}

export interface IndependentArtwork {
  kind: ObjectKind;
  name: string;
  identity: string;
  placement: string;
  behind: Behind;
  surface: string | null;
  view: string | null;
  style: string[];
  text: string[];
  box_2d: Box;
  /** Otras partes visibles del mismo elemento (p. ej. una palabra que rodea la manga). */
  more: Box[];
  distortion: string[];
  fix: string[];
  aspect: number | null;
  curved: boolean;
  photo: boolean;
  colors: string[];
  mustInclude: string[];
  missing: string[];
  holes: string[];
  issues: string[];
}

export interface PieceView {
  id: string;
  view: View;
  box_2d: Box;
  surfaces: string[];
}

export interface PieceAnalysis {
  id: string;
  productType: string;
  variant: string | null;
  garmentColor: string | null;
  views: PieceView[];
  backgrounds: BackgroundArtwork[];
  objects: IndependentArtwork[];
}

export interface AnalysisResult {
  pieces: PieceAnalysis[];
  sensitive: string[];
}

export type GlobalState = "idle" | "analyzing" | "confirm" | "recreating" | "done";
export type ItemState = "detectado" | "en_cola" | "generando" | "listo" | "error";

export type FailureCode =
  | "safety"
  | "rate_limited"
  | "no_output"
  | "timeout"
  | "missing_reference"
  | "provider_credits"
  | "auth"
  | "gateway"
  | "cancelled"
  | "unknown";

export class ProviderError extends Error {
  constructor(public code: FailureCode, message: string, public status?: number) {
    super(message);
  }
}

export type GroupMode = "posicion" | "lado_a_lado";

export interface ArtVersion {
  id: string;
  png: Blob;
  enlarged?: Blob;
  svg?: string;
  feedback: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: number;
}

export interface ArtItem {
  id: string;
  pieceId: string;
  kind: ArtworkKind | "grupo";
  name: string;
  /** Cajas a dibujar sobre la foto (un fondo puede tener varios fragmentos). */
  boxes: Box[];
  selected: boolean;
  state: ItemState;
  error?: { code: FailureCode; message: string };
  bg?: BackgroundArtwork;
  obj?: IndependentArtwork;
  group?: { mode: GroupMode; memberIds: string[] };
  versions: ArtVersion[];
  active: number;
  enlargements: number;
}

export interface Extraction {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: Blob;
  width: number;
  height: number;
  analysis: AnalysisResult | null;
  items: ArtItem[];
  promptVersion: string;
}

export interface OpLog {
  id: string;
  intent: string;
  extractionId: string;
  itemId: string | null;
  operation:
    | "analizar"
    | "recrear"
    | "ampliar"
    | "vectorizar"
    | "recortar"
    | "generar"
    | "editar"
    | "fondo"
    | "fuente"
    | "buscar-fuente";
  provider: string;
  model: string;
  status: "ok" | "error";
  failure: FailureCode | null;
  inputHash: string;
  promptVersion: string | null;
  startedAt: number;
  durationMs: number;
}
