"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import { MarketingHeader } from "@/components/shared/marketing-header";
import { ApiMintScene } from "@/components/marketing/api-mint-scene";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/store/project-store";
import { useProcessing } from "@/hooks/use-processing";
import type { PreparedImport } from "@/lib/processing/types";


// Light heuristic: does this pasted blob look like an API spec we can parse?
// Actual parsing/validation is delegated to parseOpenAPIFromContent — this only
// guards against hijacking arbitrary clipboard pastes (e.g. copied prose).
function looksLikeSpec(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  const head = t.slice(0, 4000).toLowerCase();
  return (
    /["']?(openapi|swagger)["']?\s*:/.test(head) || // OpenAPI / Swagger (JSON or YAML)
    (head.includes("info") && (head.includes("paths") || head.includes("schema"))) ||
    head.includes("_postman_id") || // Postman collection
    head.includes("postman_collection")
  );
}

export default function HomePage() {
  const router = useRouter();
  const { run, stage, cancel } = useProcessing();
  const { spec, setSpec, setCurrentStep, setError, error } = useProjectStore();
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSampleLoading, setIsSampleLoading] = useState(false);
  const [isPasteParsing, setIsPasteParsing] = useState(false);

  // Do NOT auto-redirect when a persisted/in-memory spec exists. Persistence is
  // now on, so bouncing returning users into the editor would trap them here.
  // Instead we surface a "Continue where you left off" CTA below.
  const hasSession = Boolean(spec);

  const handleImport = () => {
    setIsNavigating(true);
    router.push("/import");
  };

  const handleContinue = () => {
    setIsNavigating(true);
    setCurrentStep("editor");
    router.push("/editor");
  };

  // Mirrors import/page.tsx's handleTrySample: fetch the bundled sample spec,
  // parse it through the shared parser, store it, and advance to the editor.
  const handleTrySample = async () => {
    setIsSampleLoading(true);
    setError(null);
    try {
      const res = await fetch("/samples/petstore.json");
      if (!res.ok) throw new Error("Could not load the sample spec");
      const content = await res.text();
      const prepared = await run<PreparedImport>({ action: "parse", content, filename: "petstore.json" });
      setSpec(prepared.spec, "Petstore (sample)", prepared);
      setCurrentStep("editor");
      router.push("/editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sample");
      setIsSampleLoading(false);
    }
  };

  // Global ⌘V / Ctrl+V paste — reuse the shared parser, then jump to the editor.
  const handleGlobalPaste = useCallback(
    async (e: ClipboardEvent) => {
      // Don't hijack paste while the user is typing into an input/textarea/editable.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeSpec(text)) return;

      e.preventDefault();
      setIsPasteParsing(true);
      setError(null);
      try {
        const prepared = await run<PreparedImport>({ action: "parse", content: text, filename: "pasted-spec" });
        setSpec(prepared.spec, "Pasted Content", prepared);
        setCurrentStep("editor");
        router.push("/editor");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That didn't look like a valid spec",
        );
        setIsPasteParsing(false);
      }
    },
    [router, setSpec, setCurrentStep, setError, run],
  );

  useEffect(() => {
    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  }, [handleGlobalPaste]);

  return (
    <div className="min-h-screen relative">
      <MarketingHeader />
      {(isSampleLoading || isPasteParsing) && <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95"><Loader2 className="animate-spin" /><p>{stage}</p><Button onClick={cancel}>Cancel</Button></div>}

      <main className="pt-14 relative z-10">
        {/* ═══ HERO — Full viewport, asymmetric ═══ */}
        <section className="flex min-h-[calc(100vh-56px)] flex-col lg:flex-row">
          {/* Left — Oversized headline */}
          <div className="flex-1 flex flex-col justify-center px-8 md:px-16 lg:px-24 py-20">
            <div className="hero-enter max-w-2xl space-y-8">
              {/* Status pill */}
              <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                <span className="w-1.5 h-1.5 bg-primary animate-subtle-pulse" />
                <span>v0.1.0 · beta</span>
              </div>

              {/* Headline — stacked, oversized */}
              <h1
                className="text-[clamp(3rem,8vw,7rem)] font-bold leading-[0.95] tracking-[-0.03em]"
                style={{ fontFamily: "'Clash Display', sans-serif" }}
              >
                <span className="block">Your API.</span>
                <span className="block">
                  Minted for <span className="text-primary">MCP.</span>
                </span>
              </h1>

              {/* Description */}
              <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
                Turn an OpenAPI or Postman spec into a deployable MCP server.
                Inspect every tool, trim context, run a trust scan, then download
                TypeScript or Python without sending your file anywhere.
              </p>

              {/* Continue where you left off — only when a session is persisted */}
              {hasSession && (
                <button
                  onClick={handleContinue}
                  disabled={isNavigating}
                  className="flex items-center gap-3 w-full max-w-md border border-primary/40 bg-primary/[0.04] hover:bg-primary/[0.08] hover:border-primary/60 px-4 py-3 transition-colors text-left group"
                >
                  <div className="flex-1">
                    <div className="text-[10px] text-muted-foreground tracking-[0.15em] uppercase">
                      Resume session
                    </div>
                    <div className="text-sm font-semibold text-foreground">
                      Continue where you left off
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-primary transition-transform group-hover:translate-x-1" />
                </button>
              )}

              {/* CTA */}
              <div className="flex flex-wrap items-center gap-4 pt-4">
                <Button
                  onClick={handleImport}
                  disabled={isNavigating}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 text-sm font-semibold tracking-wide transition-all duration-200 hover:translate-x-1"
                >
                  {isNavigating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading
                    </>
                  ) : (
                    <>
                      Mint an MCP server
                      <ArrowRight className="w-4 h-4 ml-3" />
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleTrySample}
                  disabled={isSampleLoading || isNavigating}
                  className="border-border hover:border-primary/60 hover:text-primary px-8 py-6 text-sm font-semibold tracking-wide"
                >
                  {isSampleLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading sample
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2 text-primary" />
                      Try the Petstore spec
                    </>
                  )}
                </Button>

                <Link
                  href="/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors border-draw pb-1"
                >
                  Read docs →
                </Link>
              </div>

              {/* Keyboard hint */}
              <div className="pt-4 text-[11px] text-muted-foreground tracking-wider flex items-center">
                {isPasteParsing ? (
                  <span className="flex items-center text-primary">
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Parsing pasted spec...
                  </span>
                ) : (
                  <>
                    <kbd className="px-2 py-1 border border-border bg-surface text-xs">⌘V</kbd>
                    <span className="ml-2">to paste spec directly</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile proof — static, compact, and below the primary action. */}
          <div className="hero-enter hero-enter--scene px-5 pb-12 lg:hidden">
            <ApiMintScene compact />
          </div>

          {/* Desktop proof — the API-to-MCP transformation is the visual. */}
          <div className="hero-enter hero-enter--scene hidden w-[48%] items-center justify-center border-l border-border bg-surface p-8 xl:p-12 lg:flex">
            <ApiMintScene />
          </div>
        </section>

        {/* ═══ FEATURES — Numbered blocks with thick borders ═══ */}
        <section className="border-t-2 border-primary">
          <div className="max-w-[1400px] mx-auto">
            {[
              {
                num: "01",
                title: "Inspect before you expose",
                desc: "See capability gaps, destructive operations, unsupported auth, and every generated tool before you download code.",
                proof: ["Capability report", "Trust scan", "Request sandbox"],
              },
              {
                num: "02",
                title: "Spend context on what matters",
                desc: "Watch the context budget as you select tools, or collapse a large API into three compact meta-tools without losing safe dispatch.",
                proof: ["Live token meter", "Compact mode", "Tool presets"],
              },
              {
                num: "03",
                title: "Leave with proof, not promises",
                desc: "Download a runnable Node.js or Python server with tests, documentation, provenance, dependency pins, and an SBOM.",
                proof: ["TS or Python", "SBOM included", "Registry ready"],
              },
            ].map((feature, i) => (
              <div
                key={feature.num}
                className={`relative flex flex-col items-start gap-5 overflow-hidden px-8 py-14 sm:flex-row sm:gap-10 md:gap-16 md:px-16 lg:px-24 lg:py-16 ${
                  i < 2 ? "border-b border-border" : ""
                }`}
              >
                {/* Watermark number */}
                <div className="watermark">{feature.num}</div>

                {/* Number */}
                <div
                  className="shrink-0 text-5xl font-bold text-primary/20 sm:w-20 md:w-28 md:text-7xl"
                  style={{ fontFamily: "'Clash Display', sans-serif" }}
                >
                  {feature.num}
                </div>

                {/* Content */}
                <div className="max-w-xl sm:pt-2 md:pt-4">
                  <h3
                    className="text-xl md:text-2xl font-semibold mb-3 tracking-tight"
                    style={{ fontFamily: "'Clash Display', sans-serif" }}
                  >
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {feature.proof.map((item) => (
                      <span key={item} className="border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ FOOTER ═══ */}
        <footer className="border-t border-border px-8 md:px-16 lg:px-24 py-8">
          <div className="max-w-[1400px] mx-auto flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground tracking-[0.15em] uppercase">
              mcpmint · MIT Licensed
            </span>
            <div className="flex gap-6 text-[11px] text-muted-foreground tracking-wider">
              <a href="https://github.com/mcpmint/mcpmint" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
                GitHub
              </a>
              <a href="/docs" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
                Docs
              </a>
            </div>
          </div>
        </footer>

        {/* Error bar — mirrors the import page */}
        {error && (
          <div role="alert" className="fixed bottom-0 left-0 right-0 bg-red/10 border-t-2 border-red px-6 py-3 flex items-center justify-between z-30">
            <span className="text-sm text-red">
              <span className="font-bold tracking-wider uppercase">Error: </span>
              {error}
            </span>
            <button onClick={() => setError(null)} className="text-red hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
