# Production deployment and search verification

mcpmint is a Next.js application with prerendered public pages and server API routes. Use a compatible Next.js server deployment. A pure static export cannot provide the URL fetch proxy, server generation or security headers.

## Build and application checks

1. Set `NEXT_PUBLIC_SITE_URL` to the actual HTTPS production origin before building. The existing `https://make-mcp.vercel.app` fallback is retained intentionally. Paths, queries and credentials are rejected in this setting. It is a public URL, not a secret.
2. Use Node 22 or newer, `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:generator`, `npm run test:workflow`, `npm run test:cli`, and `npm run build`.
3. Run `npm run test:generated:full` where Node and Python dependency installation is available. This runs the exported sample projects locally; the public app never starts uploaded code.
4. Run `npm audit --audit-level=low` in the root and CLI directories. Keep their lockfiles committed.
5. Start the production build with `npm start`. Run `npm run test:production:browser` against it. Install Chromium with `npx playwright install chromium`, or set `BROWSER_PATH` to an installed Chromium executable. Set `BASE_URL` if the server is not at `http://127.0.0.1:3000`. Optional `BROWSER_EVIDENCE_PATH` saves the results and `BROWSER_SCREENSHOT_DIR` saves the mobile capture.

The browser suite uses synthetic files and intercepts external traffic. It verifies the production worker/CSP, 25 MiB rejection, corrupted files, large imports, selection caps, ZIP download, preview, editor/export refresh, recursive schemas, failed browser storage with portable recovery, legacy storage migration, an intercepted HTTPS live request, and public SEO resources.

## Hosting and API configuration

- Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as server-only secrets for shared rate limiting across server instances. Without them, the limiter is per instance and best effort. Never prefix credentials with `NEXT_PUBLIC_`.
- Vercel client-IP headers are trusted only when `VERCEL=1`. On another host, enable `MCPMINT_TRUST_X_FORWARDED_FOR=1` or `MCPMINT_TRUST_X_REAL_IP=1` only if your trusted proxy overwrites the relevant header. Otherwise requests share an `unknown` limiter bucket rather than trusting spoofable headers.
- Keep the response security headers from `next.config.ts`. Workers require same-origin script access. Browser live requests intentionally permit HTTPS and `localhost` / `127.0.0.1` development servers; the sandbox also enforces the imported base origin, rejects redirects, omits browser credentials and requires acknowledgement for mutations. Upstream CORS still applies.
- Keep outbound server fetch protections in place: HTTP(S) only, public IPs only, DNS-pinned connections, validation at every redirect, a 10-second budget including DNS, and bounded response bodies. These protections do not require a static export.
- Verify `/api/health`, successful URL imports, and generation on the deployed host. Use a disposable development API for actual live tests; the automated suite does not send real requests to user APIs.
- Browser projects are scoped to the site origin. Before moving domains, export portable project backups; IndexedDB cannot migrate automatically across origins.

## Search engines and AI search agents

The repository provides unique canonical URLs, prerendered documentation, honest SoftwareApplication / WebSite / Organization / TechArticle structured data, `/robots.txt`, `/sitemap.xml`, social images, a touch icon, and `/llms.txt`. Editor and Export depend on browser state and send `noindex, follow`; they are omitted from the sitemap. The sitemap does not manufacture modification dates on every build.

After deployment, verify the following against the actual public origin:

1. Fetch the home page and each documentation URL without JavaScript. Confirm titles, descriptions, canonical URLs, visible article content and structured data refer to that origin.
2. Fetch `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/opengraph-image`, `/twitter-image`, `/favicon.ico` and `/apple-icon.png`. Confirm successful responses and correct MIME types. Unknown pages must return HTTP 404 with a usable home link.
3. Confirm redirects resolve to one HTTPS origin and that preview deployments do not become competing indexed copies. Apply a deployment-level `X-Robots-Tag: noindex` to previews if the hosting platform does not already provide it.
4. Check hosting/CDN/WAF rules and logs for successful requests from verified crawlers. The wildcard robots policy allows search crawlers, including OAI-SearchBot, Googlebot, Bingbot, Claude-SearchBot and PerplexityBot. Crawler user-agent strings alone are not proof of authenticity; use each provider's current verification guidance.
5. Submit the sitemap in verified Google Search Console and Bing Webmaster Tools properties. Inspect crawl/index coverage and canonical selection. If the production domain changes, rebuild with the new public origin and configure redirects from the old one.

OAI-SearchBot controls OpenAI search crawling. GPTBot is a separate training crawler; a training opt-out decision is distinct from search discoverability. This change preserves the existing wildcard policy rather than silently deciding that policy for the site owner. `llms.txt` is an optional documentation index; it is not a required search protocol and does not guarantee ingestion or citations. No repository change can promise appearance or ranking in ChatGPT or another agent's search results. Live CDN policy, domain ownership, search console properties and actual indexing require access to the deployed services.

## Dependency maintenance notes

The Next.js and YAML dependencies are updated, and the unused Swagger Parser dependency is removed in favor of bounded, local reference resolution. Patched transitive overrides cover `js-yaml`, PostCSS, sharp, the compatible brace-expansion major versions and `@humanfs/node`. Next's ESLint plugin uses only `fast-glob.globSync(..., { onlyDirectories: true })`; its vulnerable micromatch/braces dependency chain is replaced with the compatible `tinyglobby` alias. Linting validates that compatibility. Review these overrides when upstream dependencies remove the affected chains.
