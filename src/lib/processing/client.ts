import { PROCESSING_TIMEOUT_MS } from "./limits";
import type { ProcessingRequest, ProcessingMessage } from "./types";

export interface ProcessingOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

/** Each task owns a worker: cancellation, errors, timeout and success all release its memory. */
export function runProcessing<T>(
  request: ProcessingRequest,
  options: ProcessingOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Processing cancelled.", "AbortError"));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./task.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      reject(
        new Error(
          "Could not start file processing. Reload the page and try again.",
        ),
      );
      return;
    }
    let completed = false;
    const finish = (error?: Error, result?: T) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result as T);
    };
    const abort = () =>
      finish(new DOMException("Processing cancelled.", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Processing took too long. Reduce the specification and try again.",
          ),
        ),
      PROCESSING_TIMEOUT_MS,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        new Error(
          "File processing failed to start or stopped unexpectedly. Reload and try again.",
        ),
      );
    };
    worker.onmessageerror = () =>
      finish(
        new Error(
          "Could not read the processing result. Try a smaller specification.",
        ),
      );
    worker.onmessage = ({ data }: MessageEvent<ProcessingMessage<T>>) => {
      if (data.type === "progress") options.onProgress?.(data.stage);
      else if (data.type === "error") finish(new Error(data.error));
      else if (data.type === "success") finish(undefined, data.result);
    };
    try {
      worker.postMessage(request);
    } catch {
      finish(
        new Error(
          "Could not send this specification for processing. Re-import the file.",
        ),
      );
    }
  });
}
