# Public beta launch runbook

Start with local Node + stdio, reviewed OpenAPI/Postman inputs and a documented client. Keep recursive references, browser live calls and provider deployment adapters outside the advertised scope. Application accounts are not required for this release.

## Before publishing

1. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:generator`, `npm run test:workflow`, `npm run test:cli`, `npm run audit:dependencies`, and `npm run build`. Install Chromium and run `npm run test:browser`. With Python 3.11+ available, run `MCPMINT_AUDIT_GENERATED=1 npm run test:generated:full`. CI runs these checks.
2. Confirm the intended public domain in metadata, canonical URLs and sitemap. Open `/`, `/guide` and `/privacy` on the deployed build. Verify HTTPS and production response headers. Confirm editor/export stay excluded from indexing.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the hosting platform's secret store for distributed rate limits. Set a deliberate `MCPMINT_RATE_LIMIT_MAX`. The memory fallback is per process and is not equivalent to a shared production limit. Verify requests across instances hit the same quota and receive 429 plus Retry-After. Test a Redis outage and document the fallback behavior.
4. Leave `MCPMINT_TRUST_X_REAL_IP` disabled unless the platform overwrites that header and prevents direct access to the origin. Verify platform forwarding behavior with spoofed incoming headers before enabling it. Never trust arbitrary client-supplied forwarding headers.
5. Assign a named release/incident owner. Monitor public-page availability, API 5xx/429 counts, latency, Redis failures and client setup support reports. Logs must exclude uploaded bodies, pasted specs, URLs, tool names, project names and secrets; use coarse route/error codes. Test that alerts reach the assigned owner.
6. Save the previous deploy ID and a known-good commit. Rollback means redeploying that exact build and restoring compatible environment settings. Recheck import, default archive download and a safe tool call after rollback. Preserve user browser projects; do not ask users to clear all storage as the first recovery step.
7. Exercise clean archives on the actual desktop clients and operating systems you advertise. Complete initialize → tools/list → a safe tool call with named upstream auth and separate MCP bearer auth where applicable. Record client/runtime versions and the exact supported combinations. Validate SSE separately before promoting it.
8. Have 5–10 pilot developers try their own supported specs using only the published instructions. Record sanitized setup problems and time to the first completed call. Downloads alone are not activation. Expand promotion after recurring failures are understood and recoverable.

## Measurement

Optional PostHog telemetry is now implemented; enable it with the public project token and API host described in [the deployment setup](vercel-posthog-setup.md). It records explicit activation events with coarse format/runtime/transport, count ranges and durations. Browser Do Not Track and the privacy-page opt-out disable collection. Automatic capture and recording are disabled. Do not collect spec text, input URLs, endpoint/tool/project names or credentials. Distinguish self-reported first-call completion from a machine-verified event. Set targets from pilot evidence, not invented conversion numbers.

## During beta

Review failure/support reports daily during the initial release. Reproduce with sanitized fixtures, fix regressions, and update `/guide` when supported scope changes. Review dependency alerts weekly; the temporary dev-only audit exception expires on 6 November 2026. Do not promote generated provenance as signed independent build evidence or a direct inventory as a transitive package lock.
