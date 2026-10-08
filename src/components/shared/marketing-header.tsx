"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function MarketingHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-background/95">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="border-draw flex items-center">
          <span
            className="text-base font-semibold tracking-tight"
            style={{ fontFamily: "'Clash Display', sans-serif" }}
          >
            mcp<span className="text-primary">mint</span>
          </span>
        </Link>

        <nav aria-label="Homepage" className="flex items-center gap-1 sm:gap-3">
          <Link
            href="/docs"
            className="hidden px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Documentation
          </Link>
          <Link href="/guide" className="px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">Quickstart</Link>
          <ThemeToggle />
          <Button variant="ghost" size="icon" asChild>
            <a
              href="https://github.com/mcpmint/mcpmint"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open mcpmint on GitHub"
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              <Github aria-hidden="true" className="size-4" />
            </a>
          </Button>
        </nav>
      </div>
      <div className="h-px bg-border" aria-hidden="true" />
    </header>
  );
}
