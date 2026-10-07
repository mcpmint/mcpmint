# Vercel account migration and PostHog setup

## Deploy through the connected GitHub repository

A different Vercel account can deploy this repository as a new project. Being logged into Zen authorizes dashboard actions there; it does not authenticate the separate cloud workspace's Vercel CLI. This workspace has no Vercel CLI credentials or old project link, and its network proxy blocks Vercel website/API access. Use the logged-in browser or a local terminal for deployment. The old account's environment values have not been inspected.

1. Publish the tested changes on a branch and review the pull request. Connecting GitHub alone does not publish local workspace changes. Vercel builds the commit on its configured branch.
2. In your existing Vercel project, confirm Settings → Git connects `mcpmint/mcpmint` and check the production branch. For a new project, use Add New → Project → Import Git Repository. Root directory is the repository root; framework is Next.js; install command `npm ci`; build command `npm run build`; Node.js 22 or later. Keep the default Next.js output settings.
3. Add the environment variables below in the Vercel project before building the preview. Configure Preview and Production scopes deliberately. For the initial production deployment use the new project's actual Vercel URL as the site URL. Add a custom domain later and update the site URL before redeploying. The code also recognizes Vercel's automatic production-project domain.
4. Verify the branch preview and GitHub checks, then merge the reviewed pull request into the configured production branch when ready to deploy. Check `/api/health`, `/guide`, `/privacy`, sample import, archive generation and a safe tool call. Check the PostHog event stream with your own ordinary test journey.
5. The old `make-mcp.vercel.app` address remains owned by the original Vercel project; a fresh project needs another address. If a custom domain is attached to the old account and you control DNS, follow Vercel's domain ownership-verification procedure to add it to the new project. Confirm the new deployment first, then change DNS deliberately. An account transfer requires access to the old account or help from Vercel support.

Browser projects are tied to the site origin. Before moving to a different hostname, export portable projects from the old site and import them on the new one. Keeping the same custom hostname preserves that browser storage.

## Environment variables

| Name | Value / purpose | Needed? |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Your new production origin, e.g. `https://your-project.vercel.app` | Set explicitly for correct metadata |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Your public `phc_` project token | To enable analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | Supplied US host: `https://us.i.posthog.com` | With analytics |
| `UPSTASH_REDIS_REST_URL` | Redis REST endpoint | Optional; recommended for shared rate limits |
| `UPSTASH_REDIS_REST_TOKEN` | Secret Redis REST token | Required if using Upstash |
| `MCPMINT_RATE_LIMIT_MAX` | Default `20` requests per minute per IP per API route | Optional |
| `MCPMINT_TRUST_X_REAL_IP` | Leave unset on Vercel | Optional advanced proxy setting |

Public `NEXT_PUBLIC_*` values are included in the JavaScript bundle at build time. Changing them requires a redeployment. The PostHog project token is public, not a personal API key. Keep Upstash credentials in Vercel's environment settings, not in Git. Configure production and preview scopes deliberately; use a separate PostHog project for previews if you want to keep pilot data separate.

The supplied PostHog values are configured in the ignored local `.env.local`. They are not committed to `.env.example`. The old Vercel project's settings are unknown; there are no production secret values in this workspace. No database or app-login environment values are required. Upstream API keys and MCP bearer credentials belong to exported servers, not this web app.

## PostHog collection policy

PostHog initializes only when a project token is configured and the browser has not opted out. Do Not Track is respected; storage failure disables collection. The privacy page includes a per-browser opt-out. SDK state is in memory, so a full page reload starts a new anonymous identity. No accounts or person profiles are created.

Events: `$pageview`, `import_started`, `import_succeeded`, `import_failed`, `selection_completed`, `preview_succeeded`, `preview_failed`, `generation_succeeded`, `generation_failed`, `installation_instructions_copied`, and `first_tool_call_completed`. The last event always includes `confirmation: self_reported`.

Properties are fixed route/category names, runtime/transport, browser/server generation, compact-mode selection, bucketed tool counts and bounded durations. The outbound filter also strips SDK-added full URLs, query strings, referrers and person-property updates. Specs, names, inputs, credentials, raw errors, and installation snippets are excluded. Automatic capture, session replay, console recording, exception capture, heatmaps, surveys and feature-flag requests are disabled. The SDK is bundled locally; CSP permits only the configured HTTPS ingestion origin for analytics.

Create a funnel from `import_succeeded` → `selection_completed` → `generation_succeeded` → `installation_instructions_copied` → `first_tool_call_completed`. Break down by runtime/transport and compare failure events. Page views use the `route` property instead of full URL capture. Anonymous identities reset on full reload, so this setup measures a continuous app session rather than long-term returning users. Provider requests still expose normal network metadata.

Local production-browser tests intercept ingestion and inspect payloads without sending test events to the live project. Actual receipt in your PostHog dashboard must be checked after deployment.

### Documentation review

The integration uses the documented npm installation and no-external SDK entry point, with `defaults: "2026-05-30"` pinned explicitly. Manual page views cover Next.js navigation without collecting full URLs. There is no login identity to identify; the SDK assigns an anonymous ID. The defaults snapshot does not override the explicit privacy settings above.

Re-enabling analytics also restores SDK consent after a prior opt-out and full reload. Browser checks cover continuous-journey identity, manual route events, outbound privacy filtering, opt-out, re-enable, and Do Not Track. These checks validate local outgoing traffic, not receipt in the live PostHog project.

Validation after the correction: production build, TypeScript check, targeted ESLint, three analytics privacy unit tests and both production-browser PostHog tests passed. Browser ingestion was intercepted throughout; no verification events were sent to the live project.
