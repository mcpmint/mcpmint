# mcpmint deployment and search-agent audit

## Remediation completed on 8 October 2026

All 15 repository findings below have been addressed. The original audit is preserved as baseline evidence; its failure verdict and dependency counts describe commit `a10fd05`, not the revised application. Next.js is now 16.4.0. The app still requires a Next.js server because it uses API routes and security response headers.

| Finding | Resolution |
| --- | --- |
| F01 | Parsing, analysis, preview and ZIP generation run in a dedicated same-origin worker. ZIP compression stays within that worker, avoiding fflate's nested blob-worker CSP failure. |
| F02 | Patched runtime and development dependencies, removed unused Swagger Parser, updated both lockfiles and documented compatible transitive overrides. Root and CLI audits report zero vulnerabilities. |
| F03 | Worker processing, bounded schema/reference traversal, one-update bulk selection, indexed tool/capability lookup, 100-row pagination and bounded capability overview. Export analysis and trust scans also run in workers. |
| F04 | Shared 5 MiB UTF-8 specification limit, JSON/YAML file validation, 10,000-operation and structural budgets, and 500-tool selection/export limits. Portable project files use a separate 20 MiB budget. |
| F05 | Bounded local reference resolution preserves finite recursive `$ref` edges; circular YAML object aliases and external references fail with actionable messages. External references must be bundled locally. |
| F06 | Structured-clone IndexedDB storage replaces full-session localStorage serialization, migrates legacy data, starts writes immediately, shows storage failures and allows portable export of unsaved work. Named project operations are asynchronous. |
| F07 | Editor and Export wait for persistence hydration before deciding whether a project is missing. Both restore successfully on refresh. |
| F08 | Native export disclosures actually open on desktop and remain keyboard operable on mobile. Red Trust Scan findings keep downloads disabled until visible acknowledgement. |
| F09 | CSP explicitly permits same-origin workers and user-initiated HTTPS / loopback connections. Live requests still enforce the imported origin and upstream CORS; reference resolution never initiates external requests. |
| F10 | Worker file reads are caught, portable projects receive complete structural/canonical validation, editor errors are visible, and route/global error recovery pages are present. |
| F11 | Sandbox responses are capped by streaming byte counts before decoding/JSON parsing, cancel at the limit and retain request timeouts. Live requests and probes are aborted on unmount. |
| F12 | Unique public metadata and canonical URLs; session pages use `noindex, follow` and are absent from the sitemap. No build-time fake modification dates. Public origin configuration is validated. |
| F13 | Five prerendered first-party guides, documentation navigation, honest structured data and `/llms.txt`. Wildcard crawler access remains enabled; deployed crawler access and actual indexing need post-deploy verification. |
| F14 | Parser/generator libraries load in worker chunks. Initial route JavaScript drops by approximately 29–35% before compression, depending on route. Preview and export analysis are no longer rebuilt on each UI render. |
| F15 | Branded custom 404, route/global error recovery and Apple touch icon. Existing fixed OG/Twitter image generation remains buildable. |

Additional fixes cover the server fetch timeout before DNS resolution, platform-only trust of Vercel forwarding headers, explicit proxy-header opt-in elsewhere, invalid rate-limit configuration, bounded fallback limiter memory, disabled browser storage in theme handling, and accurate generation privacy/storage copy.

Current validation: production build, lint and TypeScript pass; 64 generator, 17 parser, 14 API, 52 workflow and 6 CLI tests pass, plus both full generated Node/Python verification checks. Root and CLI dependency audits report zero affected package entries. All 33 production browser checks and the API smoke checks pass; the browser suite is now part of CI. It uses synthetic specifications and intercepted external responses, not actual user files or live upstream mutations.

The same 500-operation ZIP fixture now downloads successfully, including a generated file larger than the old 160 KB fflate worker threshold, with no CSP violations. The 2,000- and 6,000-operation fixtures restore across editor and export refreshes, render 100 endpoint rows, remain within the 500-tool cap, and do not overflow the tested desktop/mobile layouts. Framework rendering and cross-thread/storage cloning still take measurable main-thread time; worker isolation removes the previous multi-second parsing and generation stalls, not every possible browser long task.

Initial JavaScript measured from production HTML script assets (worker/lazy chunks excluded):

| Route | Bytes | Gzip bytes |
| --- | ---: | ---: |
| `/` | 761,030 | 241,492 |
| `/import` | 846,557 | 266,911 |
| `/editor` | 823,635 | 261,856 |
| `/export` | 881,673 | 277,787 |

Current machine-readable evidence is saved in [remediation evidence](deployment-remediation-2026-10-08-evidence.json).

See [deployment verification](deployment-verification.md) for the repeatable checks, dependency override rationale and live hosting/search steps. No deployment was performed. CDN/WAF crawler access, verified search properties and actual ChatGPT/other-agent indexing cannot be established from local tests; `llms.txt` and metadata do not guarantee citations or rankings.

## Original audit at `a10fd05`


Audited 8 October 2026, against commit `a10fd05`, using the supplied deployment checklist. The baseline below records the original audit before remediation. See the completed fixes and current validation above.

**Original audit verdict: hold release for the processing and dependency findings below.** The production build and all 146 existing tests pass, but production-browser checks reproduce broken large ZIP downloads, multi-second UI blocking, recursive-schema failures, and inaccessible desktop export controls. Basic search crawlability exists. The site needs better URL policies and public documentation to support discovery and useful citations by search agents.

## What was verified

The app uses Next.js 16.2.10, React 19.2.3, TypeScript, and Tailwind 4. It prerenders `/`, `/import`, `/editor`, and `/export`, while `/api/fetch-spec`, `/api/generate`, and `/api/health` require a server runtime. `next.config.ts` does not enable `output: "export"`.

Consequently, this is a Next.js deployment with static pages and server APIs. Deploying only HTML/CSS/JS would break URL imports and server-mode generation. Next.js documents request-dependent handlers and custom response headers among the constraints of [static exports](https://nextjs.org/docs/app/guides/static-exports). Retain the Next.js runtime unless those features are deliberately moved elsewhere.

Validation ran with Node 24.19.0 and system Chromium against `next build` followed by `next start`, with the real production CSP enabled. The repository CI uses Node 22; a fresh installation under that CI version was not repeated. Browser fixtures were synthetic OpenAPI files; no user specifications or credentials were used. External browser requests were intercepted and aborted, so the tests do not depend on third-party API availability. CSP violation events distinguish policy failures from intercepted network requests.

| Check | Result |
| --- | --- |
| `npm run build` | Pass; all pages and metadata routes prerender successfully |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test:generator` | Pass: 64 generator, 13 parser, 14 API tests |
| `npm run test:workflow` | Pass: 47 tests |
| `npm run test:cli` | Pass: 6 tests |
| `npm run test:generated:full` | Pass: generated Node and Python projects, 2 tests |
| `npm audit --json` | Fail: 1 critical, 12 high, 3 moderate affected package entries |
| `npm audit --omit=dev --json` | Fail: 1 critical, 9 high, 2 moderate affected package entries |
| Production route checks | Robots, sitemap, favicon, OG image, Twitter image return 200; unknown page returns 404 |
| Production API smoke checks | Invalid generation request, private-IP spec URL, and `file:` spec URL rejected with 400 |
| Production browser checks | Multiple failures, detailed below |

These vulnerability counts are npm's affected-package counts, including inherited dependency findings; they are not counts of independent exploitable flaws in this app.

## Checklist results

| Checklist item | Status | Evidence / implication |
| --- | --- | --- |
| Global metadata | Partial | Title, description, language, robots, canonical, OG and Twitter exist. Route-specific canonical and indexing policies are missing. |
| Custom 404 | Gap | Next's default 404 returns the correct HTTP status. No `src/app/not-found.tsx`, home link, `error.tsx`, or `global-error.tsx`. |
| Robots and sitemap | Partial | Correct metadata conventions at `src/app/robots.ts` and `src/app/sitemap.ts`. Sitemap includes empty session-dependent pages. |
| OG / favicon / Apple icon | Partial | Favicon and generated OG/Twitter PNGs work. Apple touch icon missing. Generated `.tsx` image routes are valid; literal PNG files are not required. |
| Worker isolation | Fail | Parsing, validation, normalization, code generation and much compression run on the main thread. fflate workers for larger files are blocked by CSP. |
| WASM / binary chunking | N/A | No WASM implementation or application WASM assets found. No reason to add WASM configuration. |
| Memory cleanup | Partial | Application-created download URLs are revoked. No demonstrated application blob-URL leak. Storage amplification and uncancelled processing remain problems; repeated-session heap leak testing was not performed. |
| File boundaries | Partial | Initial file drop and import-page paste enforce 5 MiB. Home clipboard and editor updates bypass it; workload limits differ between import and export. |
| Progress states | Partial | Spinners and overlays exist. Synchronous work freezes animation; blocked workers leave generation pending indefinitely. No processing cancellation or meaningful stage feedback. |
| Friendly failures | Partial | Normal upload errors appear in an alert. Project-file read failures are unhandled; update-spec errors are invisible in the editor. |
| Large-input UI checks | Fail | 25 MiB upload rejected correctly, but accepted inputs under 5 MiB block the UI and overflow storage. Large ZIP export fails. |
| Clean production build | Pass | Build, separate lint, and separate typecheck all pass. A Next.js build is not a replacement for lint. |
| No client secrets | Pass within inspected scope | Only application `NEXT_PUBLIC_*` setting is the public site origin. No production secret patterns found in inspected application sources; Upstash secret variable names absent from emitted client chunks. Live deployment variables and git-history secret scanning were not inspected. |
| Bundle size / splitting | Needs work | Homepage references approximately 1.16 MB of initial JS, about 335 KB when gzip-compressed per asset. Heavy parser imports are eager. YAML and Postman already use dynamic imports. |

## Prioritized findings

P1 means fix before release. P2 means fix in the next deployment-hardening pass. P3 means a lower-impact improvement.

### F01 · P1 · Production CSP breaks large browser ZIP downloads

Evidence: [next.config.ts](/workspace/mcpmint/next.config.ts:13), [client-generate.ts](/workspace/mcpmint/src/lib/client-generate.ts:112). There is no `worker-src` directive; its fallback does not permit `blob:`. fflate's browser implementation creates workers using `URL.createObjectURL(new Blob(...))`. Its asynchronous ZIP API compresses files under 160,000 bytes synchronously and uses workers for larger individual files.

A one-operation project downloaded successfully. A 500-operation, 366,292-byte specification imported successfully but produced three `worker-src` violations for `blob:` URLs during browser generation. No download occurred and the button remained “Generating.” Thus small-file smoke tests miss the failure.

Fix: explicitly permit the required worker origin, for example `worker-src 'self' blob:` for the current implementation, or replace blob workers with bundled same-origin workers. Propagate worker startup/error failures, apply a deadline, and expose retry/cancel. Do not add production `unsafe-eval` to solve this. Verify both a small project and a generated file over fflate's worker threshold under the final production CSP.

### F02 · P1 · The dependency security gate fails

Evidence: [package.json](/workspace/mcpmint/package.json:46), `package-lock.json`, and the recorded npm audit responses. Installed Next.js is 16.2.10. The audit reports critical Next.js advisories plus high findings in runtime/transitive packages. The full audit also includes development-tool findings.

The package overrides pin `js-yaml` to 4.3.0, `fast-uri` to 4.1.1 beneath swagger-parser, and Next's `postcss` to 8.5.20. Those versions fall in reported vulnerable ranges, so updating only top-level dependencies is insufficient.

Triage reachability instead of calling every advisory an exploitable app vulnerability. For example, the [next/og RCE advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) requires attacker-controlled values in Node ImageResponse SVG content, attributes or styles. The current social images use fixed content, and the build prerenders them; that exploit condition was not established. Likewise, the [metadata dynamicParams advisory](https://github.com/advisories/GHSA-f87g-xv8r-7p7x) describes webpack and excluded dynamic segments, unlike the current Turbopack/root-image setup. Windows-only, Server Action, image-optimization, and self-hosting findings also need deployment-specific assessment.

Fix: update to compatible patched Next.js/ESLint packages, refresh the lockfile, and replace obsolete overrides with reviewed compatible patched versions. The checked Next.js advisories require at least 16.3.8 for their listed fixes; the registry reports 16.4.0 as current. Do not blindly apply `npm audit fix --force`: npm suggests a major downgrade of eslint-config-next for part of the development-tool graph. Re-run both audits, CI tests, production build, and browser checks after the deliberate update.

### F03 · P1 · Accepted specifications freeze the main thread

Evidence: [openapi.ts](/workspace/mcpmint/src/lib/parsers/openapi.ts:23), [project-store.ts](/workspace/mcpmint/src/store/project-store.ts:566), [editor/page.tsx](/workspace/mcpmint/src/app/editor/page.tsx:112), [export/page.tsx](/workspace/mcpmint/src/app/export/page.tsx:276).

`JSON.parse`, Swagger dereferencing/model conversion, validation, capability analysis, tool creation and synchronous persistence execute on the UI thread. Declaring a function `async` does not move this work to a worker. Editor rows are not virtualized; each row searches the tool array. Selection presets and “all visible” call store updates in a loop, repeatedly serializing the full working state. Export also rebuilds the scan, signatures and generation plan during renders.

Measured in production Chromium:

| Operations | File bytes | Time to editor, including rendering | Longest observed main-thread task | Longest timer gap |
| --- | ---: | ---: | ---: | ---: |
| 500 | 366,292 | 812 ms | 199 ms | 274 ms |
| 2,000 | 1,468,792 | 2,052 ms | 729 ms | 1,038 ms |
| 6,000 | 2,612,792 | 5,260 ms | 2,205 ms | 3,095 ms |

These are end-to-end observations on this machine, not isolated parser benchmarks or guaranteed timings on user devices. A separate 501-tool “none visible” action took 1,124 ms with an 843 ms timer gap.

Fix: put parse/normalize/validate and code generation in bounded cancellable workers. Preserve references safely when communicating models across the worker boundary. Batch tool selection into one store update, debounce large persistence writes, index tools by ID, virtualize long lists, and memoize export computations. Add stage feedback and ensure a paint can occur before synchronous fallbacks. Verify responsiveness on slower devices after the change.

### F04 · P1 · Boundaries can be bypassed, and imports exceed generator limits

Evidence: [import/page.tsx](/workspace/mcpmint/src/app/import/page.tsx:36), [home clipboard handler](/workspace/mcpmint/src/app/page.tsx:84), [editor update handler](/workspace/mcpmint/src/app/editor/page.tsx:129), [generator request validation](/workspace/mcpmint/src/lib/generator/request.ts:9).

The initial upload and import-page paste enforce 5 MiB. A 6,291,705-byte home clipboard spec reached the editor. A 6,291,683-byte “Update spec” file also imported. The older `SpecDropzone` component has no size limit, but it is not wired into the currently inspected routes; treat that as dormant code, not a demonstrated live entry point.

Import accepts thousands of operations, whereas the generator permits at most 500 selected tools. A 501-operation GET specification arrived with all tools selected and an enabled download button, then failed with raw Zod JSON stating `Too big: expected array to have <=500 items`. Compact mode does not bypass request validation. Byte limits also cannot prevent small but deeply nested or reference-amplified graphs.

Fix: centralize byte, operation-count, depth, reference and work budgets for every entry point. Apply cheap file-size/type checks before reading, byte checks before text parsing, and structural budgets in the worker. Either support the same limits end-to-end or explain the selected-tool limit before enabling export. Browser `accept` attributes supplement validation; they do not enforce it.

### F05 · P1 · Valid recursive schemas fail with stack overflow

Evidence: [Swagger dereference call](/workspace/mcpmint/src/lib/parsers/openapi.ts:12), [recursive validation traversal](/workspace/mcpmint/src/lib/parsers/openapi.ts:211), [recursive example generation](/workspace/mcpmint/src/store/project-store.ts:307).

A small valid OpenAPI response schema whose `Node.child` references `Node` failed import with “Maximum call stack size exceeded.” SwaggerParser allows circular dereferenced objects by default. Downstream validation traverses object values without a visited set or depth budget; example generation has similar recursive assumptions. Persistence and signatures additionally require JSON-serializable data. The generator's own bounded schema conversion does not protect these earlier paths.

Fix: choose a consistent cycle-safe schema representation, preferably preserving recursive references rather than serializing cyclic dereferenced graphs. Add visited/depth guards to all graph walkers and explicit guidance where a shape cannot be represented. Cover recursive request and response schemas, shared references, and deep nesting from all import paths.

### F06 · P2 · Working-session persistence fails silently for allowed input sizes

Evidence: [safeLocalStorage](/workspace/mcpmint/src/store/project-store.ts:532), [persistence selection](/workspace/mcpmint/src/store/project-store.ts:985), [raw operation retention](/workspace/mcpmint/src/lib/api-model/openapi.ts:399).

The 1.47 MB fixture occupied about 4.87 million serialized characters in localStorage. The 2.61 MB fixture triggered `QuotaExceededError`, leaving only the small default state persisted. The UI continued with the in-memory spec and console warnings; the automatic working-session path did not give the user a clear persistence-failure notice. A refresh can therefore discard work that appeared restored automatically for smaller specs.

The model keeps overlapping representations: canonical operations, raw source operations, legacy endpoints, and generated tool configuration. Named-project snapshots can add another copy. This is storage amplification, not evidence of a heap leak.

Fix: reduce duplicate raw data, move large projects to IndexedDB, and display persistence status/failure for the working session as well as named projects. Offer a recoverable portable export path when storage is unavailable. Save/report actual write success before displaying a saved state.

### F07 · P2 · Refreshing a saved workflow redirects to home

Evidence: [editor redirect](/workspace/mcpmint/src/app/editor/page.tsx:60), [export redirect](/workspace/mcpmint/src/app/export/page.tsx:267).

After a successful small download and saved session, reloading `/export` returned to `/`; the home page then showed “Resume session.” Direct visits to editor/export also returned home despite storage being present in the browser tests. The redirect checks run while the initial store snapshot can still report no spec.

Fix: wait for the persisted-store hydration state before deciding a session is absent. Test direct URLs and refresh with a valid saved session, no session, unavailable storage, and a legacy session. Use replacement navigation for the absence case to avoid history loops.

### F08 · P1 · Desktop progressive disclosures hide their content and opening controls

Evidence: [ResponsiveDisclosure](/workspace/mcpmint/src/app/export/page.tsx:1177), [desktop CSS](/workspace/mcpmint/src/app/globals.css:591).

The component renders a closed native `<details>` and hides its `<summary>` at desktop widths. CSS sets the body to `display: block`, which does not reliably override native closed-details behavior. At 1365 px in the tested Chromium, both the outer summary and inner request-sandbox summary were invisible, and its desktop heading was invisible. The Trust Scan body also measured zero height in the desktop check. Below the desktop breakpoint the summary could be opened normally.

This can prevent review of security settings and acknowledgement of red Trust Scan findings, which gate downloads. Passing tests that match source strings for progressive disclosure do not establish browser visibility or keyboard accessibility.

Fix: make native details actually open for the desktop presentation, or use separate semantic desktop sections with a shared content implementation. Preserve keyboard-accessible mobile summaries. Test desktop/mobile visibility, tab order, and the ability to acknowledge a red scan without DOM manipulation.

### F09 · P2 · Network policy conflicts with advertised live and reference features

Evidence: [production connect-src](/workspace/mcpmint/next.config.ts:23), [live sandbox fetch](/workspace/mcpmint/src/lib/sandbox/request.ts:164), [installation probe](/workspace/mcpmint/src/components/export/installation-wizard.tsx:105).

The CSP permits connections only to the app and Fontshare hosts. After opening the sandbox through its mobile disclosure, a GET to the synthetic imported origin yielded “Failed to fetch” and a `connect-src` violation. A spec with an external `$ref` likewise failed with a `connect-src` violation. The generated-server connection probe also targets a different origin, commonly localhost, and conflicts with the same policy. CORS and mixed-content/private-network restrictions are additional constraints after CSP is fixed.

Fix: define the intended supported network model. Use an explicit deployment allowlist or a properly secured, explicitly invoked proxy for live tests; retain origin and mutation checks. For private local-file parsing, disable automatic external reference fetching by default and support prebundled specs or explicitly supplied local reference files. Do not silently introduce remote fetches into the promised private import path.

### F10 · P2 · File-reader and editor error handling has gaps

Evidence: [project-file reader](/workspace/mcpmint/src/app/import/page.tsx:196), [editor error handler](/workspace/mcpmint/src/app/editor/page.tsx:129), [portable project validation](/workspace/mcpmint/src/store/project-file.ts:44).

Rejecting `File.text()` during portable-project import produced an unhandled page error and no visible friendly error. A malformed “Update spec” file left the editor unchanged with no visible parse-error message: the handler writes a store error that the editor does not display. Portable project parsing validates only a shallow subset before casting the entire object. The reusable ErrorBoundary is not mounted in the inspected routes, and there are no App Router error files.

Fix: catch file reads as well as parsing, clear progress in `finally`, surface editor errors with an accessible alert, and validate portable-project contents with a complete bounded schema before storing them. Add appropriate route/global error recovery. A custom 404 handles missing routes; it does not catch arbitrary async callback errors.

### F11 · P2 · Live-response memory limit is checked after full allocation

Evidence: [request.ts](/workspace/mcpmint/src/lib/sandbox/request.ts:173).

The live sandbox calls `response.text()` before comparing `raw.length` with 262,144. A much larger response is therefore already downloaded and allocated before rejection. String length also measures UTF-16 code units, not the advertised byte limit. This issue is code-established; no external oversized response was fetched during this audit.

Fix: stream bytes with a running cap and cancel as soon as it is crossed, optionally reject an oversized declared Content-Length early, then decode only the accepted bytes. Keep the timeout active for the full read.

### F12 · P2 · Canonicals and sitemap disagree with indexable content

Evidence: [global canonical](/workspace/mcpmint/src/app/layout.tsx:68), [sitemap](/workspace/mcpmint/src/app/sitemap.ts:14), [site origin](/workspace/mcpmint/src/lib/site.ts:7).

Every page's generated HTML uses the homepage title and homepage canonical, including `/import`, `/editor`, and `/export`. The sitemap nevertheless lists all four as separate URLs. Editor/export have almost no usable public body content without a session and redirect through client effects. Those are poor search landing pages. The sitemap's `lastModified` values are build time rather than a known content-update date.

Fix: give indexable public pages their own server-defined title, description, canonical and OG URL. Put session-only editor/export under `noindex, follow` and remove them from the sitemap; if import is indexable, give it useful public explanatory text and a unique canonical. Use a real editorial timestamp or omit `lastModified`. Keep one validated production origin across redirects, canonicals, robots, social cards and the sitemap. The old-name Vercel fallback is explicitly documented as intentional; a wrong deployed domain was not established.

### F13 · P2 · Search agents can crawl the product but have little owned documentation to cite

The home page is prerendered with an H1 and readable product text; `"use client"` does not make it invisible to crawlers. Its first public body content contains approximately 215 whitespace-separated words in the inspected HTML, with docs links going to GitHub. There are no first-party product guide routes, JSON-LD or `llms.txt`. JSON-LD and llms.txt are optional improvements, not prerequisites for AI-search inclusion.

Fix: publish substantive, stable, linked pages that answer the actual product questions: what Model Context Protocol is; OpenAPI/Swagger-to-MCP conversion; Postman-to-MCP conversion; supported/unsupported features; browser privacy versus URL/server/live-test modes; limits; local and remote deployment; client setup; and trust-scan limitations. Make statements match tested capabilities and link to primary protocols/documentation. Add appropriate WebSite/Organization/SoftwareApplication structured data that agrees with visible facts; do not invent prices, reviews, ratings or unsupported integrations.

The discovery plan below explains which crawler settings matter and which outcomes remain unverified.

### F14 · P2 · Marketing pages eagerly ship the parser dependency graph

Evidence: [homepage imports](/workspace/mcpmint/src/app/page.tsx:11), [parser imports](/workspace/mcpmint/src/lib/parsers/openapi.ts:1), [browser generator imports](/workspace/mcpmint/src/lib/client-generate.ts:21).

Unique initial script references in emitted production HTML measured:

| Route | Raw JS bytes | Estimated gzip bytes |
| --- | ---: | ---: |
| `/` | 1,156,633 | 335,039 |
| `/import` | 1,234,636 | 357,019 |
| `/editor` | 1,203,356 | 349,643 |
| `/export` | 1,361,584 | 386,806 |

These sum referenced JS assets per route, including shared runtime/vendor scripts. Gzip is computed per asset, not read from CDN transfer headers; CSS, fonts, RSC payloads, later dynamic chunks and prefetches are excluded. Next 16's build output here prints route types without a JS size map, so this audit measured emitted assets directly. The largest individual JS chunk is about 549 KB raw / 140 KB gzip.

Fix: keep the public marketing shell independent of the parser/store/generator graph where practical; lazy-load parsing on import/sample/paste actions and code generation on preview/download actions, or inside their workers. Retain existing YAML/Postman splitting. Use ordinary `import()` for processing libraries; `next/dynamic` is for React components, and `ssr: false` is not a general library-loading requirement. Re-measure initial assets and real browser performance after splitting.

### F15 · P3 · Missing recovery and touch-icon polish

Evidence: default production 404 has no links; `/apple-icon.png` returns 404. `favicon.ico`, OG image, and Twitter image all return 200. Next's file-based icon/image conventions do not generate every desired size automatically from any arbitrary file.

Fix: add a branded `not-found.tsx` with a real home link, plus an appropriately sized Apple touch icon. Keep correct HTTP 404 and noindex behavior. Add route error recovery separately as described in F10.

## Search-agent visibility plan

### Existing permissions are already permissive

Generated robots.txt currently contains:

```text
User-Agent: *
Allow: /
Disallow: /api/

Sitemap: https://make-mcp.vercel.app/sitemap.xml
```

With no more-specific blocking groups, this already allows the public pages to OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot and Bingbot. Local production requests using all five agent names returned 200 with HTML and no homepage noindex directive. Adding redundant named allow groups alone will not improve the content or ranking; if specific groups are introduced, preserve the API exclusions in each relevant group.

OpenAI identifies **OAI-SearchBot** as its search crawler and recommends permitting both its robots tag and published crawler IPs. **GPTBot** concerns training; its setting is independent. **ChatGPT-User** is a user-initiated fetcher, not the search-index crawler. Training access does not have to be enabled to be eligible for search. See [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots).

Anthropic separates **Claude-SearchBot**, **Claude-User**, and its training-oriented **ClaudeBot**. Preserve search access independently from any training preference. See [Anthropic crawler documentation](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler).

Perplexity identifies **PerplexityBot** as its search crawler and recommends allowing its published IP ranges as well as robots access; **Perplexity-User** serves user requests. See [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers).

Google's AI search features use the same foundational SEO requirements as Search: crawlable, indexed, snippet-eligible pages with useful text and internal links. No special AI file or special schema is required. See [Google's guidance](https://developers.google.com/search/docs/appearance/ai-features). An optional `/llms.txt` can provide an accurate, compact documentation index for agents that use it, with links to real public pages; it is not evidence of indexing or a guarantee of appearing in answers.

### Recommended implementation order

1. Settle the production origin, validate it at build time, and keep any old-domain redirects consistent. Fix canonical/noindex/sitemap policy as in F12.
2. Publish first-party, statically rendered conversion and setup guides, supported-feature/limit documentation, and an accurate privacy page. Give each public page a descriptive title, H1, summary, canonical and direct navigation links. A normal link to the import flow is also more crawlable than a navigation-only button.
3. Add honest structured data for the product and organization, and link to the public source repository as an identity reference. Validate that markup against visible content. Add an optional llms.txt documentation index after the destination pages exist.
4. Check the actual deployed CDN/WAF for successful crawler responses to homepage, guides, robots, sitemap and social assets. Watch for CAPTCHA, JavaScript challenges, login, geographic restrictions, and custom noindex headers. If a verified-bot exception is needed, validate the current provider IP ranges; trusting only a claimed User-Agent is insufficient.
5. Verify the production property in Google Search Console and Bing Webmaster Tools, submit the final sitemap, and inspect representative public pages. A Google verification HTML file already exists in `public/`; its existence does not prove property verification or indexing.
6. Monitor actual crawler visits, indexing, referring traffic and citations over time. Search Console access, CDN logs, live deployment configuration, and existing agent referrals were not available for this audit.

The live fallback URL, robots URL and sitemap URL could not be fetched by the browsing service during this audit. That is an **unverified live-deployment state**, not proof that the website is down or blocks crawlers. Local successful bot-name requests likewise do not prove the CDN will admit provider crawler IPs. No claim is made that mcpmint is currently indexed or will necessarily appear in ChatGPT, Claude, Perplexity or Google AI answers.

## Additional deployment checks

The spec-fetch proxy has useful protections: scheme restrictions, private/reserved-address filtering, validated DNS pinning, per-hop redirect checks, a streamed 5 MiB limit, a timeout, and rate limiting. Public generation validates the request, limits workloads and archive names, and forces process-spawning verification off. The public API tests and local rejection smoke checks pass. Browser generation imports the pure generator path rather than Node archive/process modules. These protections should be preserved.

Rate limiting is distributed only if the optional Upstash settings are configured. Otherwise it is per-instance best effort. The code trusts Vercel/forwarding IP headers; a self-hosted deployment must strip or overwrite those headers at its trusted edge. Actual production limiter configuration and multi-instance behavior remain unverified. Initial DNS lookup in spec fetching occurs before the 10-second request timer, while the platform budget is 15 seconds; slow DNS/redirect-resolution behavior should be tested for the intended host.

Security headers, local Fira Code hosting, reduced-motion styling, basic input rejection, and cleanup of application download URLs are positive foundations. CSP currently includes inline-script allowances; it is not a complete XSS mitigation. No broad CSP relaxation is recommended just to make failing browser paths appear to work.

This audit covers the application/deployment checklist and its generated-project validation tests. It does not certify the full historical repository, production infrastructure, every generated API behavior, repeated-session heap stability, real-device Core Web Vitals, or an exhaustive accessibility/security penetration test.

## Release acceptance criteria

- Both dependency audit gates pass, or every remaining advisory has a documented, reviewed deployment-specific disposition. Compatible upgrades do not reintroduce forced-vulnerable overrides.
- Browser ZIP download succeeds for generated files above the worker threshold under the production CSP; startup failure and cancellation recover visibly.
- Every import/update path shares the same byte and structural budgets. Selected-tool limits appear before generation. Valid recursive schemas work or receive an intentional supported-limits explanation without stack overflow.
- Accepted large inputs leave the UI responsive; bulk selection is batched; persistence failure is visible and recoverable.
- Editor/export refresh waits for hydration. Desktop and mobile export controls remain visible and keyboard accessible, including red-scan acknowledgement.
- Project-file read failures, invalid updated specs and failed live requests show friendly accessible errors. Live reads enforce a streamed byte cap.
- Public indexable pages have accurate route metadata, canonical URLs and useful prerendered content. Session-only pages are absent from the sitemap and noindexed.
- Actual production crawler access and indexability are checked at the CDN and in webmaster tools. Search inclusion is measured rather than assumed from robots permissions.

The companion [browser evidence](/workspace/mcpmint/docs/deployment-audit-2026-10-08-evidence.json) records the synthetic production-browser observations. Temporary build, test and dependency logs were retained under `/tmp/mcpmint-audit-*` during the audit.
