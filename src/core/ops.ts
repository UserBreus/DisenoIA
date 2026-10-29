// Registro de cada operación con proveedores (duración, modelo, error normalizado, hash de entradas).
import { logOp } from "./store";
import { uid } from "./queue";
import { ProviderError, type OpLog } from "./types";

export type OpInfo = Omit<OpLog, "id" | "status" | "failure" | "startedAt" | "durationMs">;

export async function tracked<T>(op: OpInfo, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const out = await fn();
    void logOp({ ...op, id: uid("op-"), status: "ok", failure: null, startedAt, durationMs: Date.now() - startedAt });
    return out;
  } catch (e) {
    const failure = e instanceof ProviderError ? e.code : "unknown";
    void logOp({ ...op, id: uid("op-"), status: "error", failure, startedAt, durationMs: Date.now() - startedAt });
    throw e;
  }
}
