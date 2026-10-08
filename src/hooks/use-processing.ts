"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runProcessing } from "@/lib/processing/client";
import type { ProcessingRequest } from "@/lib/processing/types";

export function useProcessing() {
  const controller = useRef<AbortController | null>(null);
  const [isProcessing, setProcessing] = useState(false);
  const [stage, setStage] = useState("");
  const cancel = useCallback(() => controller.current?.abort(), []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(async <T>(request: ProcessingRequest): Promise<T> => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setProcessing(true);
    setStage("Preparing…");
    try {
      return await runProcessing<T>(request, {
        signal: task.signal,
        onProgress: setStage,
      });
    } finally {
      if (controller.current === task) {
        controller.current = null;
        setProcessing(false);
      }
    }
  }, []);
  const runURL = useCallback(
    async <T>(url: string, filename?: string): Promise<T> => {
      controller.current?.abort();
      const task = new AbortController();
      controller.current = task;
      setProcessing(true);
      setStage("Fetching specification…");
      const timeout = setTimeout(() => task.abort(), 60_000);
      try {
        const response = await fetch("/api/fetch-spec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: task.signal,
        });
        const data = await response.json();
        if (!response.ok || typeof data.content !== "string")
          throw new Error(data.error || "Could not fetch the specification.");
        return await runProcessing<T>(
          { action: "parse", content: data.content, filename: filename || url },
          { signal: task.signal, onProgress: setStage },
        );
      } finally {
        clearTimeout(timeout);
        if (controller.current === task) {
          controller.current = null;
          setProcessing(false);
        }
      }
    },
    [],
  );
  return { run, runURL, isProcessing, stage, cancel };
}
