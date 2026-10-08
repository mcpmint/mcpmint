"use client";
import { useSyncExternalStore, useState } from "react";
import { storageStatus } from "@/lib/project-storage";
import { useProjectStore } from "@/store/project-store";
export function StorageNotice() {
  const status = useSyncExternalStore(
    storageStatus.subscribe,
    storageStatus.getSnapshot,
    storageStatus.getServerSnapshot,
  );
  const error = useProjectStore((state) => state.error);
  const spec = useProjectStore((state) => state.spec);
  const exportProject = useProjectStore((state) => state.exportProject);
  const setError = useProjectStore((state) => state.setError);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      const text = await exportProject();
      if (!text) return;
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "project.mcpmint.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  };
  if (status !== "error" && !error) return null;
  return (
    <aside
      className="border-b border-red/40 bg-background px-4 py-3 text-xs text-red"
      role="alert"
    >
      <span>
        {error ||
          "Browser storage failed. Keep this tab open and export your project before leaving."}
      </span>
      {spec && (
        <button
          className="ml-4 underline"
          disabled={exporting}
          onClick={download}
        >
          {exporting ? "Preparing…" : "Export project file"}
        </button>
      )}
      {error && status !== "error" && (
        <button
          aria-label="Dismiss error"
          className="ml-4 underline"
          onClick={() => setError(null)}
        >
          Dismiss
        </button>
      )}
    </aside>
  );
}
