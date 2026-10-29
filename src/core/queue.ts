// Cola con límite de concurrencia e idempotencia por "intent".
import { CLIENT } from "./limits";

type Task<T> = () => Promise<T>;

export class Queue {
  private running = 0;
  private waiting: Array<() => void> = [];
  private intents = new Map<string, Promise<unknown>>();

  constructor(private limit = CLIENT.concurrency) {}

  /** Ejecuta la tarea respetando la concurrencia. El mismo intent nunca se ejecuta dos veces a la vez. */
  run<T>(intent: string, task: Task<T>): Promise<T> {
    const existing = this.intents.get(intent);
    if (existing) return existing as Promise<T>;
    const p = this.acquire()
      .then(task)
      .finally(() => {
        this.release();
        this.intents.delete(intent);
      });
    this.intents.set(intent, p);
    return p;
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((res) => this.waiting.push(() => (this.running++, res())));
  }

  private release() {
    this.running--;
    this.waiting.shift()?.();
  }
}

export const uid = (prefix = "") => `${prefix}${crypto.randomUUID().slice(0, 13)}`;
