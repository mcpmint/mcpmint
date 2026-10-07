"use client";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/store/project-store";
import { Button } from "@/components/ui/button";

export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  function downloadRecovery() {
    const raw = localStorage.getItem("makemcp-storage") || "{}";
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "mcpmint-session-recovery.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6">
    <h1 className="text-2xl font-semibold">This project could not be opened</h1>
    <p className="text-sm text-muted-foreground">Retry, or keep a local recovery copy before importing your original specification again. Saved project history is retained. Recovery data may include private API details; review it before sharing.</p>
    <div className="flex flex-wrap gap-3">
      <Button onClick={reset}>Try again</Button>
      <Button variant="outline" onClick={downloadRecovery}>Download recovery data</Button>
      <Button variant="outline" onClick={() => { useProjectStore.getState().reset(); router.push("/import"); reset(); }}>Start a new import</Button>
    </div>
  </main>;
}
