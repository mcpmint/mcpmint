"use client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
export function ProcessingOverlay({
  stage,
  cancel,
}: {
  stage: string;
  cancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-background/95"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="animate-spin text-primary" />
      <p>{stage}</p>
      <Button variant="outline" onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}
