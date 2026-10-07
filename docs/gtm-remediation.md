# GTM remediation record

6 October 2026. Implements the 20 findings in [the initial review](gtm-readiness-review.md). Application login remains out of scope, as requested. Changes to credentials below concern the generated MCP servers and their upstream APIs.

## Finding-by-finding status

| # | Status | Resolution and evidence |
| --- | --- | --- |
| 1 | Fixed with a declared dev exception | Patched Next/parser/transitive packages and generated tooling; app production, CLI and generated Node audits are clean. CI rejects new advisories. One unpatched dev-only ESLint glob dependency is accepted until 6 November; see [policy](dependency-policy.md). |
| 2 | Fixed | Security, scan, sandbox and evidence disclosures have visible native summaries at every width and start open. Production browser tests cover visible scan acknowledgement and access settings. |
| 3 | Fixed | Browser and CLI scan the same normalized generation-plan projection. Regression tests compare nested schemas, renamed arguments, destructive annotations, findings and the hash subject. |
| 4 | Fixed | New projects receive independent UUIDs. Saves update only the explicitly active ID. Browser tests save two pasted APIs; portable imports create copies. |
| 5 | Resolved by narrowing support | Recursive and external references receive specific, recoverable errors. Bundle external references first. Depth/node/size budgets prevent cyclic or oversized portable state from entering persistence. Parser and browser tests retain the current project on failure. Recursive generation is not supported. |
| 6 | Fixed | Node instructions include installation and build. Python client commands use an absolute virtual-environment interpreter. Project-relative dotenv loading works when launched elsewhere. |
| 7 | Fixed instructions; client certification pending | Installation metadata selects Python HTTP `/mcp`, localhost for wildcard bind addresses, named credentials and MCP authorization headers. Unsupported remote Claude Desktop JSON is removed. Real desktop clients/OS combinations remain explicitly uncertified. |
| 8 | Fixed | Credential names come from the actual plan's auth schemes; Claude Code preserves environment flags. Regression tests cover named bearer credentials and remote headers. |
| 9 | Fixed | Empty-origin generated tests use an allowed localhost origin. The browser-downloaded default ZIP is included in verification, alongside the expanded full-install matrix. |
| 10 | Fixed | Both runtimes use operation → path → document server precedence. Postman requests preserve their individual origins, including base paths. `API_BASE_URL` is an optional explicit override of all operations. |
| 11 | Resolved by narrowing support | Browser sandbox provides inspection and mocks. Real requests use the local CLI/generated server/Inspector; unsupported browser probes are removed. Restrictive CSP remains. |
| 12 | Fixed | HTTP checks send MCP initialization with correct headers/path. Registration checks and user-reported first-call confirmation have accurate labels. No generic HTTP response is counted as verified connectivity. |
| 13 | Fixed supported subset; limitations disclosed | Node preserves null unions, common bounds/patterns and additional-properties policies. Python validates full normalized operation schemas. Unsupported/partially represented keywords produce review notes. Composition and Node oneOf exclusivity require review. |
| 14 | Fixed Docker; cloud claims narrowed | Tests are copied only when enabled. Both targets read host/port overrides and images bind to all container interfaces. Transport is selected at generation. Placeholder provider deploy buttons are removed. Actual Node tests-on/off and Python image builds plus HTTP MCP calls are checked locally. |
| 15 | Fixed | Node deadline/cancellation/redirect rejection and streamed 1 MiB cap; Python client timeout, redirect rejection and byte cap; sandbox streams with a 256 KiB cap. Error bodies are redacted. Multipart/binary inspection uses matching serialization rules. Generated tests exercise byte caps and error redaction. |
| 16 | Fixed | Portable projects validate complete configs, tools, relationships and budgets before writes. Hydration validates persisted state and preserves valid history. Route recovery supports retry, session backup and reset. Browser tests cover malformed imports and damaged sessions. |
| 17 | Fixed | Mobile preview/refresh, naming/saving and wrapping import controls are available at 320 px. Searchable files replace the tab wall. The preview summary strip wraps after generation. |
| 18 | Fixed tested issues | Endpoint expansion uses a separate native button; fields have associated labels; theme-aware semantic colors fix contrast. Production axe checks cover both themes and the import/editor/export flow. Automated checks do not certify all assistive technologies. |
| 19 | Fixed | Regeneration preserves configured auth, tool names and selections. Source auth/default-server drift appears in update summaries. Diff regression tests cover configuration drift. |
| 20 | Fixed copy/artifact scope | Privacy explains browser persistence, URL fetch, optional server generation and ancillary services. Inventory is direct-only and unenforced; provenance is unsigned generation metadata; registry output is a template. Archive completion is distinct from a connected server. |

## Verification

| Final check | Result |
| --- | --- |
| TypeScript, ESLint, production build, CLI bundle/help | Passed |
| Generator / parser / API tests | 69 / 15 / 14 passed |
| Workflow / CLI behavior tests | 51 / 6 passed |
| Full generated-project fixtures | 5 passed, with generated Node audits enabled |
| Production Chromium flows and axe checks | 5 passed; both themes and 320 px covered |
| Untouched browser-downloaded default Node ZIP | Install/build, all 8 generated tests, audit and MCP tool call passed |
| Node Docker tests on/off; Python HTTP Docker | Builds passed; both container runtimes initialized, listed/called tools and rejected invalid arguments on overridden ports |
| Actual local protocol matrix | 7 passed: default browser ZIP, Node/Python compact HTTP, Python HTTP, Node/Python stdio, named bearer stdio from another directory |
| Production app / CLI / generated Node audit | Zero findings; root dev-only exception documented |

Repository checks include TypeScript, ESLint, production Next build, generator/parser/API/workflow/CLI tests, production Chromium flows and axe checks. Full generated verification installs real pinned dependencies and checks Node regular/compact plus Python stdio/HTTP/compact. CI opts into generated Node audits with `MCPMINT_AUDIT_GENERATED=1`.

Local container smoke checks exercised Node and Python HTTP initialization, tools/list, a real read-only tool call and invalid-argument rejection on overridden ports. Container builds used the environment's proxy CA as a build secret; generated Dockerfiles were otherwise unchanged. This validates packaging/connectivity, not an OS-image vulnerability assessment.

The default sample ZIP is downloaded through the production browser UI, extracted, installed, built, tested and audited. Logs from this remediation are retained under `/workspace/mcpmint-review/remediation-evidence` when working in this review workspace. Repository test sources are portable; workspace logs are supporting evidence.

Optional PostHog activation tracking was subsequently added; see [Vercel and PostHog setup](vercel-posthog-setup.md) for the collection policy and new-account deployment procedure.

## Launch scope and remaining release work

The code findings are addressed through fixes or clearly narrowed supported scope. This is not a production deployment or a blanket GTM certification. The public `/guide` provides a local mock, read-only/bearer/Postman examples, compatibility limits, troubleshooting and support. `/privacy` explains processing and storage. Editor/export are excluded from indexing.

Before broader promotion, follow [the launch runbook](launch-runbook.md): verify the deployed rate limiter and trusted proxy headers, assign an incident owner, configure monitoring/rollback, test actual advertised desktop-client and OS combinations, and complete a small customer pilot. No production credentials, customer evidence or real desktop client sessions were available in this workspace. No deployment, registry publication or outbound customer messages were performed.
