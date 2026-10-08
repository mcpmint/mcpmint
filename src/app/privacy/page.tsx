import Link from "next/link";
import { AnalyticsPreference } from "@/components/analytics/analytics-preference";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { MarketingHeader } from "@/components/shared/marketing-header";
export const metadata: Metadata = { title: "Processing and privacy", description: "Understand browser processing, local project storage, server requests, and anonymous analytics controls.", alternates: { canonical: `${SITE_URL}/privacy` } };
export default function Privacy() {
  return <><MarketingHeader /><main className="mx-auto max-w-2xl space-y-6 px-6 pb-20 pt-28">
    <h1 className="text-3xl font-semibold">Where your API data goes</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">With privacy mode on, local file and pasted specifications are parsed, edited, scanned and generated in your browser. Your working session and saved projects are stored in this browser’s IndexedDB, with migration from legacy localStorage. They remain until you delete them or clear browser data; browser settings may remove them earlier.</p>
    <p className="text-sm leading-relaxed text-muted-foreground">Importing a URL asks this app’s server to fetch that URL. External schema references are rejected; bundle them into the specification before import. Switching privacy mode off sends the specification and generation settings to the app’s server to produce the archive in memory. The app does not intentionally persist these inputs on its server.</p>
    <p className="text-sm leading-relaxed text-muted-foreground">The site loads display fonts from Fontshare. When configured by the operator, PostHog receives anonymous page routes and explicit workflow events, such as import, generation, instruction copying and self-reported first-call completion. Event properties are limited to fixed categories, count ranges and elapsed times. API specs, names, URLs, query strings, referrers, form contents, credentials and raw errors are excluded. Automatic click capture, session recordings, console capture and person profiles are disabled. The anonymous analytics identifier stays in memory and resets on a full page reload. Analytics requests still expose normal network metadata to the service; hosting and third-party retention follow those providers.</p>
    <p className="text-sm leading-relaxed text-muted-foreground">Upstream credentials are configured in the generated server or your MCP client. Imported Postman examples and specifications can contain secrets: review them before saving, exporting, attaching or sharing. Portable project files and archives can contain private API details.</p>
    <p className="text-sm leading-relaxed text-muted-foreground">Delete saved projects from the import page’s Browser projects panel. Clear the current working session with Start over. To remove all session and history data, clear this site’s browser storage. Export a portable project first if you need a backup.</p>
    <AnalyticsPreference />
    <Link href="/guide" className="text-primary underline">Quickstart and compatibility</Link>
  </main></>;
}
