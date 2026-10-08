"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/store/project-store";
import { readStored } from "@/lib/project-storage";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [recoveryError, setRecoveryError] = useState("");
  async function downloadRecovery() {
    try {
      const raw = await readStored("makemcp-storage");
      if (!raw) throw new Error("No saved session is available. Open projects or import the original specification.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "mcpmint-session-recovery.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRecoveryError("");
    } catch (error) { setRecoveryError(error instanceof Error ? error.message : "Recovery data could not be read. Check browser storage settings."); }
  }
  return <main className="mx-auto max-w-xl px-6 py-24" role="alert">
    <h1 className="text-3xl font-semibold">Something went wrong</h1>
    <p className="mt-4 text-muted-foreground">Retry, or keep a local recovery copy before importing your original specification again. Saved project history is retained. Recovery data may include private API details; review it before sharing.</p>
    <div className="mt-8 flex flex-wrap gap-4">
      <Button onClick={reset}>Try again</Button>
      <Button variant="outline" onClick={() => { void downloadRecovery(); }}>Download recovery data</Button>
      <Button variant="outline" onClick={() => { useProjectStore.getState().reset(); router.push("/import"); reset(); }}>Start a new import</Button>
      <Link href="/import" className="underline">Open projects</Link>
      <Link href="/" className="underline">Home</Link>
    </div>
    {recoveryError && <p className="mt-4 text-sm">{recoveryError}</p>}
  </main>;
}
