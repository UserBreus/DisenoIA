// fetch con tiempo límite, cancelación y normalización de errores a FailureCode.
import { JOB_TIMEOUT_MS } from "../core/limits";
import { ProviderError, type FailureCode } from "../core/types";

export async function request(url: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), init.timeoutMs ?? JOB_TIMEOUT_MS);
  init.signal?.addEventListener("abort", () => ctrl.abort("cancelled"));
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw await toProviderError(res);
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (ctrl.signal.aborted) {
      const reason = ctrl.signal.reason === "cancelled" ? "cancelled" : "timeout";
      throw new ProviderError(reason, reason === "timeout" ? "El proveedor tardó demasiado." : "Operación cancelada.");
    }
    throw new ProviderError("gateway", `No se pudo conectar con el proveedor (${(e as Error).message}). Revisá la red o CORS.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function toProviderError(res: Response): Promise<ProviderError> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 600);
  } catch {
    /* sin cuerpo */
  }
  const lower = body.toLowerCase();
  let code: FailureCode = "unknown";
  if (res.status === 401 || res.status === 403) code = "auth";
  else if (res.status === 402 || /insufficient|quota|billing|credit/.test(lower)) code = "provider_credits";
  else if (res.status === 429) code = "rate_limited";
  else if (/safety|moderation|content_policy|blocked|prohibited/.test(lower)) code = "safety";
  else if (res.status >= 500) code = "gateway";
  return new ProviderError(code, `HTTP ${res.status}: ${extractMessage(body)}`, res.status);
}

function extractMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return j?.error?.message ?? j?.detail?.[0]?.msg ?? j?.detail ?? j?.message ?? body;
  } catch {
    return body || "sin detalle";
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new ProviderError("cancelled", "Operación cancelada."));
    });
  });

export const FAILURE_LABELS: Record<FailureCode, string> = {
  safety: "Bloqueado por filtro de seguridad",
  rate_limited: "Límite de solicitudes: probá en un momento",
  no_output: "El proveedor no devolvió imagen",
  timeout: "Tiempo agotado",
  missing_reference: "Faltan referencias",
  provider_credits: "Sin saldo en el proveedor",
  auth: "Clave inválida o faltante",
  gateway: "Error de red o del proveedor",
  cancelled: "Cancelado",
  unknown: "Error desconocido",
};
