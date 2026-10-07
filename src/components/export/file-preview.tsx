"use client";
import { useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";

function group(name: string): string {
  if (name.startsWith("src/")) return "Source";
  if (name.startsWith("tests/")) return "Tests";
  if (name.endsWith(".md")) return "Documentation";
  if (/sbom|provenance|manifest|dependencies|license|attestation/i.test(name)) return "Evidence";
  return "Configuration";
}

export function FilePreview({ files }: { files: Array<{ name: string; content: string }> }) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState(files[0]?.name || "");
  const selected = files.find((file) => file.name === selectedName) || files[0];
  const matching = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="min-w-0 border-t border-border">
    <label htmlFor="preview-search" className="sr-only">Search generated files</label>
    <input id="preview-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file…" className="h-11 w-full border-b border-border bg-background px-4 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary" />
    <div className="grid min-w-0 sm:grid-cols-[160px_minmax(0,1fr)]">
      <nav aria-label="Generated files" className="max-h-48 overflow-auto border-b border-border bg-surface p-2 sm:max-h-[560px] sm:border-b-0 sm:border-r">
        {["Source", "Configuration", "Tests", "Documentation", "Evidence"].map((category) => {
          const grouped = matching.filter((file) => group(file.name) === category);
          return grouped.length ? <div key={category}>
            <div className="px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">{category}</div>
            {grouped.map((file) => <button key={file.name} type="button" aria-current={selected?.name === file.name ? "true" : undefined} onClick={() => setSelectedName(file.name)} className={`block min-h-9 w-full break-all px-2 py-1 text-left text-[11px] focus-visible:outline-2 focus-visible:outline-primary ${selected?.name === file.name ? "bg-primary/10 text-primary" : "text-foreground hover:bg-background"}`}>{file.name}</button>)}
          </div> : null;
        })}
        {!matching.length && <p className="p-2 text-xs text-muted-foreground">No matching files.</p>}
      </nav>
      <div className="min-w-0 bg-background">
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 break-all text-xs">{selected?.name}</span>
          <CopyButton value={selected?.content || ""} />
        </div>
        <pre tabIndex={0} aria-label={`${selected?.name || "Generated file"} contents`} className="max-h-[520px] overflow-auto p-4 text-[11px] leading-5"><code>{selected?.content}</code></pre>
      </div>
    </div>
  </div>;
}
