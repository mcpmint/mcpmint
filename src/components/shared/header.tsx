"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjectStore } from "@/store/project-store";

const STEPS = [
  { key: "import", label: "IMPORT" },
  { key: "editor", label: "CONFIGURE" },
  { key: "export", label: "EXPORT" },
] as const;

export function Header() {
  const router = useRouter();
  const {
    spec,
    currentStep,
    reset,
    activeProjectId,
    projectName,
    autosaveStatus,
    setProjectName,
    saveCurrentProject,
  } = useProjectStore();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const progress = spec ? ((stepIndex + 1) / STEPS.length) * 100 : 0;

  const handleLogoClick = (e: React.MouseEvent) => {
    // No work loaded — navigate home freely.
    if (!spec) {
      reset();
      return;
    }
    // Work in progress — confirm before destroying it.
    e.preventDefault();
    setConfirmOpen(true);
  };

  const handleConfirmReset = () => {
    reset();
    setConfirmOpen(false);
    router.push("/");
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
        {/* Logo */}
        <Link
          href="/"
          onClick={handleLogoClick}
          className="flex items-center gap-3 group border-draw"
        >
          <span
            className="text-base font-semibold tracking-tight"
            style={{ fontFamily: "'Clash Display', sans-serif" }}
          >
            mcp<span className="text-primary">mint</span>
          </span>
        </Link>

        {spec && (
          <div className="flex min-w-0 w-[135px] lg:w-[250px] items-center gap-2 border border-border bg-surface px-2 py-1">
            <input
              aria-label="Project name"
              value={projectName}
              maxLength={80}
              onChange={(event) => setProjectName(event.target.value)}
              className="w-12 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none focus:text-primary"
            />
            {activeProjectId ? (
              <span className={`shrink-0 text-[9px] uppercase tracking-wider ${autosaveStatus === "error" ? "text-red" : "text-muted-foreground"}`} role="status">
                {autosaveStatus === "saving" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
                {autosaveStatus === "saving" ? "Saving" : autosaveStatus === "error" ? "Save failed" : "Saved"}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => saveCurrentProject()}
                className="shrink-0 text-[9px] uppercase tracking-wider text-primary hover:text-foreground"
              >
                <Save className="mr-1 inline size-3" />Save
              </button>
            )}
          </div>
        )}

        {/* Confirm start-over dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="tracking-tight">
                Start over?
              </DialogTitle>
              <DialogDescription>
                This clears your current spec and endpoint selection.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                className="border-border text-xs tracking-wider"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmReset}
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold tracking-wider"
              >
                Start over
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Progress Bar — only when spec loaded */}
        {spec && (
          <div className="hidden md:flex items-center gap-4" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}: ${STEPS[stepIndex]?.label}`}>
            <div className="flex items-center gap-6">
              {STEPS.map((step, i) => (
                <span
                  key={step.key}
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`text-[11px] tracking-[0.15em] uppercase transition-colors ${
                    i <= stepIndex
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              ))}
            </div>
            <div
              role="progressbar"
              aria-label="Project setup progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              className="w-24 h-[2px] bg-border overflow-hidden"
            >
              <div
                className="h-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Right */}
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" asChild className={spec ? "hidden sm:inline-flex" : ""}>
            <a
              href="https://github.com/mcpmint/mcpmint"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open mcpmint on GitHub"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <Github aria-hidden="true" className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>

      {/* Bottom line */}
      <div className="h-px bg-border" aria-hidden="true">
        {spec && <div className="h-full bg-primary md:hidden" style={{ width: `${progress}%` }} />}
      </div>
    </header>
  );
}
