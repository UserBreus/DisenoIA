// Caché local del trabajo de cada herramienta: se guarda solo (con una pequeña demora) y se restaura al volver.
import { deleteSession, getSession, putSession } from "./store";

export interface ToolSession<T> {
  load(): Promise<T | undefined>;
  /** Guarda con demora para no escribir en cada tecla. */
  save(data: T): void;
  /** Escribe ya lo pendiente (al salir de la página). */
  flush(): void;
  clear(): Promise<void>;
}

const pending = new Set<() => void>();
window.addEventListener("pagehide", () => pending.forEach((f) => f()));

export function toolSession<T>(id: string, delay = 400): ToolSession<T> {
  let timer = 0;
  let last: T | undefined;
  const write = () => {
    clearTimeout(timer);
    if (last !== undefined) void putSession(id, last);
    last = undefined;
    pending.delete(write);
  };
  return {
    load: () => getSession<T>(id),
    save(data) {
      last = data;
      clearTimeout(timer);
      timer = window.setTimeout(write, delay);
      pending.add(write);
    },
    flush: write,
    clear: () => deleteSession(id),
  };
}
