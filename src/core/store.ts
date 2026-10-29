// Persistencia local en IndexedDB: extracciones, archivos de la biblioteca y registro de operaciones.
import type { Extraction, OpLog } from "./types";

const DB_NAME = "disenoia";
const VERSION = 3;
let dbPromise: Promise<IDBDatabase> | null = null;

/** Archivo guardado por cualquier herramienta (biblioteca / estudio). */
export interface Asset {
  id: string;
  tool: string;
  name: string;
  blob: Blob;
  svg?: string;
  width: number;
  height: number;
  createdAt: number;
  /** Datos propios de cada herramienta (prompt, estilo, fuente detectada…). */
  meta?: Record<string, unknown>;
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("extractions")) d.createObjectStore("extractions", { keyPath: "id" });
      if (!d.objectStoreNames.contains("ops")) d.createObjectStore("ops", { keyPath: "id" }).createIndex("extractionId", "extractionId");
      if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets", { keyPath: "id" }).createIndex("tool", "tool");
      if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

/** Si IndexedDB no está disponible (modo privado estricto), la app sigue funcionando sin historial. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[DiseñoIA] almacenamiento local no disponible:", e);
    return fallback;
  }
}

const byDate = <T extends { updatedAt?: number; createdAt?: number; startedAt?: number }>(a: T, b: T) =>
  (b.updatedAt ?? b.createdAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.createdAt ?? a.startedAt ?? 0);

export const saveExtraction = (e: Extraction) => safe(() => tx("extractions", "readwrite", (s) => s.put(e)).then(() => undefined), undefined);
export const getExtraction = (id: string) => safe(() => tx<Extraction | undefined>("extractions", "readonly", (s) => s.get(id)), undefined);
export const deleteExtraction = (id: string) => safe(() => tx("extractions", "readwrite", (s) => s.delete(id)).then(() => undefined), undefined);
export const listExtractions = () => safe(async () => (await tx<Extraction[]>("extractions", "readonly", (s) => s.getAll())).sort(byDate), [] as Extraction[]);

export const saveAsset = (a: Asset) => safe(() => tx("assets", "readwrite", (s) => s.put(a)).then(() => a), a);
export const getAsset = (id: string) => safe(() => tx<Asset | undefined>("assets", "readonly", (s) => s.get(id)), undefined);
export const deleteAsset = (id: string) => safe(() => tx("assets", "readwrite", (s) => s.delete(id)).then(() => undefined), undefined);
export const listAssets = () => safe(async () => (await tx<Asset[]>("assets", "readonly", (s) => s.getAll())).sort(byDate), [] as Asset[]);

export const logOp = (op: OpLog) => safe(() => tx("ops", "readwrite", (s) => s.put(op)).then(() => undefined), undefined);
export const listOps = () => safe(async () => (await tx<OpLog[]>("ops", "readonly", (s) => s.getAll())).sort(byDate), [] as OpLog[]);

/** Estado de trabajo de cada herramienta (entradas, opciones y resultados), para retomarlo después. */
export const getSession = <T>(id: string) =>
  safe(async () => (await tx<{ id: string; data: T } | undefined>("sessions", "readonly", (s) => s.get(id)))?.data, undefined as T | undefined);
export const putSession = <T>(id: string, data: T) => safe(() => tx("sessions", "readwrite", (s) => s.put({ id, data, savedAt: Date.now() })).then(() => undefined), undefined);
export const deleteSession = (id: string) => safe(() => tx("sessions", "readwrite", (s) => s.delete(id)).then(() => undefined), undefined);

/** Lee varios archivos de la biblioteca conservando el orden (omite los borrados). */
export async function getAssets(ids: string[]): Promise<Asset[]> {
  const all = await Promise.all(ids.map((id) => getAsset(id)));
  return all.filter((a): a is Asset => !!a);
}
