import { HistoryError } from "./safety.js";

export const MAX_ACTIVE_SCANS = 2;
export const MAX_QUEUED_SCANS = 8;

/**
 * In-process FIFO admission for history scans. Waiting calls hold only their arguments; running
 * scans hold readers, so both counts are bounded and overflow fails fast with `busy`.
 */
export class ScanLimiter {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxActive = MAX_ACTIVE_SCANS,
    private readonly maxQueued = MAX_QUEUED_SCANS,
  ) {}

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.running >= this.maxActive) await this.wait(signal);
    else this.running++;
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next caller, so a new arrival cannot overtake the queue.
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  private wait(signal: AbortSignal) {
    if (this.waiting.length >= this.maxQueued)
      throw new HistoryError(
        "busy",
        "Too many history requests are queued. Retry after earlier requests finish.",
      );
    return new Promise<void>((resolve, reject) => {
      const admit = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      const cancel = () => {
        this.waiting.splice(this.waiting.indexOf(admit), 1);
        reject(
          signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
            ? new HistoryError(
                "busy",
                "Timed out waiting for earlier history requests. Retry after they finish.",
              )
            : signal.reason,
        );
      };
      this.waiting.push(admit);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
}
