# mcpmint GTM readiness review

> Historical baseline review. The findings below describe the app before remediation. See [the current finding-by-finding remediation record](gtm-remediation.md) and [launch runbook](launch-runbook.md) for fixes, validation and remaining release work.

Reviewed 6 October 2026 at commit `a10fd05`. Scope: local production build, source, browser flows, generated Node/Python projects, CLI, dependency audit, accessibility, positioning, and launch operations.

**Recommendation: hold the broad public launch.** The basic import → select → preview → download flow works, and a downloaded Node server completed an MCP handshake and tool call against a local mock API. However, normal users can lose saved projects, receive misleading scan results, and follow installation instructions that do not connect successfully. Fix the P1 findings before a beta promotion. Broader remote/cloud claims need additional validation.

This initial review was a read-only deliverable; source changes were subsequently implemented in the remediation record. Supporting logs, scripts, fixtures, and screenshots are saved in `/workspace/mcpmint-review/evidence`.

## What was verified

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Next.js production build | Passed |
| CLI bundle and help command | Passed |
| Generator tests | 64 passed |
| Parser fixtures | 13 passed |
| API helper tests | 14 passed |
| Workflow, scanner, persistence helper, and accessibility contract tests | 47 passed |
| CLI behavior tests | 6 passed |
| Full generated-project CI fixtures | Node and Python passed, 2 tests |
| Production Chromium browser | Sample import, selection, preview, and ZIP download passed |
| Actual downloaded default Node ZIP | Install/build passed; generated tests: **6 passed, 1 failed** |
| Actual downloaded Node MCP runtime | `initialize`, `tools/list`, and `tools/call` passed against a local mock API |
| Mobile at 320 CSS px | Editor/export fit; import overflowed to 360 px; preview inaccessible on mobile |
| axe accessibility, four dark-theme states | Found missing labels, nested interactive controls, and contrast failures |
| App dependency audit | 42 affected packages: 1 critical, 32 high, 9 moderate |
| App audit excluding development dependencies | 17 affected packages: 1 critical, 15 high, 1 moderate |
| CLI dependency audit | 6 high affected packages |
| Downloaded generated Node dependency audit | 2 moderate development-tool packages (`tsx`, `esbuild`) |

Initial runs failed because the restricted execution sandbox prevented local sockets and package downloads. Checks were rerun with the required access and passed except the separately reproduced failures below. The dependency audits ran after explicit user authorization. Audit counts include dependency-chain effects and do not represent that many independently exploitable issues.

Limitations: Chrome was the runtime browser tested. Real Claude Desktop, Cursor, VS Code, Windows/macOS installations, Safari, the live Vercel deployment, production rate-limit settings, Docker builds, cloud-provider deployments, and full assistive-technology behavior were not verified. Python package installation and the pinned FastMCP HTTP route were checked, but no Python network MCP tool call was performed. No exploit against a public system was attempted.

## P1 — fix before launch

### 1. Patch the audited dependencies and establish an exposure assessment

**Evidence:** `package.json`, `package-lock.json`, `cli/package-lock.json`; `mcpmint-audit.json`, `mcpmint-prod-audit.json`, and `mcpmint-cli-audit.json` in the evidence directory.

Next.js 16.2.10 is flagged critical by the current registry audit. Reported advisories include `GHSA-vcvr-r3jv-pc5j` for `next/og ImageResponse`, with an affected range of `>=16.2.0 <16.3.6`. This repository uses `ImageResponse` in its social-card routes. Other reported Next.js advisories have prerequisites such as Windows hosting, Server Actions, rewrites, or image optimization; do not claim all are exploitable here. Parser dependencies are also flagged high in both app and CLI. Existing narrow overrides do not produce a clean audit.

**Change:** upgrade to currently patched compatible releases, refresh both lockfiles, inspect actual advisory prerequisites, and rerun the complete generation/build matrix. Record any accepted development-only exceptions with their justification. Audit the generated runtime dependency graph as well as the generator app.

**Acceptance:** no untriaged critical/high production findings, CI audit passes under the repository's declared policy, and generated projects still install/build/connect.

### 2. Desktop hides security settings, scan remediation, and testing

**Source:** `src/app/export/page.tsx:1187`, `src/app/globals.css:583`.

`ResponsiveDisclosure` renders closed native `<details>`, then hides its `<summary>` at desktop widths. Setting a descendant's `display: block` does not open the native details content. Production Chromium reported all four sections as `open: false`, `summary: none`, `contentVisibility: hidden`, and height `2px`. Opening the elements restored hundreds of pixels of content.

This hides MCP access controls, Trust Scan findings/attestation, the sandbox, and supply-chain evidence. A red scan can disable generation while hiding the acknowledgement needed to continue.

**Change:** use explicit responsive open-state handling or separate desktop section/mobile disclosure rendering. Preserve keyboard access and focus when the breakpoint changes.

**Acceptance:** at 1440 px and 320 px, access settings and findings are reachable, a red scan blocks until visible acknowledgement, and resizing never strands a user.

### 3. Browser Trust Scan does not scan the schema that will be exported

**Source:** `src/lib/scanner/from-project.ts:19`, `src/store/project-store.ts:361`, `src/app/export/page.tsx:292`.

Non-body UI parameters do not retain canonical schemas. The browser scanner reconstructs them using only coarse types, while generation derives the full schema from `apiModel`. A nested query schema containing a zero-width instruction returned **browser green, 100/100**, while the same request's CLI scan returned **red, 50/100** with two findings. PUT/PATCH destructive annotations also differ between the browser scan projection and generated tools.

**Change:** scan the normalized generation plan using one shared projection for web and CLI. Use the same resolved parameter names, descriptions, requiredness, schemas, and annotations for scan, attestation, token estimation, and output. Clearly describe the scan as metadata heuristics; green is not a general security certification.

**Acceptance:** the nested-schema fixture produces equivalent findings in web and CLI, and the attestation hash describes the exact normalized metadata exported.

### 4. Saving a new pasted spec overwrites the previous project

**Source:** `src/store/project-store.ts:698`, `src/store/project-history.ts:24`, `src/app/import/page.tsx:164`.

New imports clear `activeProjectId`, but saving deduplicates by source. All pasted specs use `Pasted Content`. Reproduction: paste “First API”, Save, paste “Second API”, Save. History retained one entry with the same project ID, now named “Second API”. The first snapshot was overwritten. Different uploaded specs with the same filename face the same problem.

**Change:** assign new identity on new project creation. Update only the explicitly active project. Keep source as metadata; regeneration should be an explicit update action. Use a sufficiently robust ID such as `crypto.randomUUID()`.

**Acceptance:** two pasted APIs and two files named `openapi.json` remain independently loadable; explicit Update spec preserves the selected project's identity and customizations.

### 5. Valid recursive OpenAPI schemas fail import

**Source:** `src/lib/parsers/openapi.ts:12`, `src/lib/parsers/openapi.ts:211`, `src/store/project-store.ts:270`.

SwaggerParser can dereference recursive references into cyclic object graphs. Downstream schema walking, examples, and JSON-based persistence assume a tree. A valid `Node.children.items → Node` response schema failed the browser paste path with **“Maximum call stack size exceeded”**. The reproduction fixture is `recursive.openapi.json` in the evidence directory.

**Change:** define a serialization-safe representation for recursive references. Bound all walkers using depth/node budgets and cycle detection. If recursive generation is outside the launch scope, reject it with a precise supported-format explanation while preserving the previous project; do not leave a raw stack overflow.

**Acceptance:** recursive response and request schemas either generate correctly or receive a recoverable, specific unsupported-feature message without corrupting state.

### 6. Local Node installation omits the build required by its client config

**Source:** `src/components/export/installation-wizard.tsx:52`, `src/components/export/installation-wizard.tsx:94`, `src/lib/generator/targets/node.ts:1455`.

The Local Claude Desktop preset config runs `node <project>/dist/src/index.js`. The wizard only says to run `npm install`; the generated package has no postinstall build. A fresh archive therefore lacks the referenced entrypoint. This is a failure in the most promising first-user path.

**Change:** include install → configure environment → build → register → real tool-call verification. Derive the sequence from the exported runtime, including pnpm/yarn equivalents. For Python, use the selected virtual environment's interpreter rather than assuming a globally available `python` has the dependencies.

**Acceptance:** someone following only the visible instructions from a clean extracted ZIP reaches a completed MCP tool call.

### 7. Remote/Python client configuration loses endpoint and authentication details

**Source:** `src/components/export/installation-wizard.tsx:43`, `src/app/export/page.tsx:224`, `src/lib/generator/client-config.ts:40`, `src/lib/generator/readme.ts:23`.

The pinned FastMCP 3.4.2 HTTP application exposes `/mcp`; the wizard and shared README URL use the root. Remote presets require MCP bearer authentication, but the success snapshot omits MCP access configuration and generated client snippets contain no authorization headers or token guidance. Presets bind `0.0.0.0`, which is copied into the client destination even though it is a listener address. The wizard also offers Claude Desktop the same URL-based config used for other clients without validating client-specific support.

**Change:** generate installation metadata alongside the archive: actual endpoint path, client-reachable address, required MCP authorization, supported client registration method, and runtime commands. Distinguish bind address from public URL. Validate each claimed client; hide unsupported combinations.

**Acceptance:** Node/Python HTTP plus stdio each connect through the clients advertised for those combinations; a bearer-protected preset includes working token instructions and correct headers. Validate SSE separately before advertising it.

### 8. Wizard credentials can use different environment names from the generated server

**Source:** `src/components/export/installation-wizard.tsx:55`, `src/lib/generator/strategies/auth.ts:86`, `src/lib/generator/client-config.ts:81`.

The wizard invents one `API_KEY`/`BEARER_TOKEN`/Basic pair based on the UI's global auth selection. The generator uses canonical per-scheme names and can require several schemes. For a common scheme named `bearerAuth`, generated `.env.example` requires `BEARER_AUTH_TOKEN`; the wizard emits `BEARER_TOKEN`. The Claude Code command renderer drops the `env` object altogether. With an absolute process entrypoint, relying on a project `.env` is also unsafe because the client can launch from a different working directory.

**Change:** use `collectAuthSchemes(plan)` or generated installation metadata for all client setup, including Claude Code environment flags and secret-input guidance. Avoid putting real secret values into browser persistence or telemetry.

**Acceptance:** named bearer schemes, API keys, combined requirements, and alternative requirements work when the client starts outside the extracted project directory.

### 9. The default downloaded Node project fails its own generated tests

**Source:** `src/lib/generator/targets/node.ts:1248`.

The default HTTP export has an empty origin allow-list, which correctly denies `https://client.example.test`. The generated test nevertheless picks that as an “allowed” fallback and expects preflight status 204. Actual default ZIP: **403 !== 204**, one failed test. CI's fixed generated fixture does not cover this configuration.

**Change:** use an actually allowed localhost fallback when the plan has no list, or explicitly arrange test configuration before module import. Add the exact default browser export to the generated-project matrix.

**Acceptance:** untouched default and preset ZIPs pass their included tests after clean install.

### 10. Per-operation API servers are preserved at import but ignored at generation

**Source:** `src/lib/generator/normalize.ts:315`, `src/lib/generator/planner.ts:446`, `src/lib/generator/targets/node.ts:567`, `src/lib/generator/targets/python.ts:965`.

An OpenAPI operation with server `https://other.example.com/v2` under a root server `https://api.example.com/v1` is emitted against the root URL. The model preserves operation/path servers, but the tool plan and runtime select one global base. Tools can call the wrong service with generated credentials. Multi-host Postman collections need the same explicit support decision.

**Change:** resolve effective servers with operation → path → document precedence and deliberate environment overrides. If multi-server output is unsupported, mark affected operations for review and explain the limitation before export.

**Acceptance:** recorded outgoing requests use the selected operation's effective server; unsupported cases cannot show “ready” without qualification.

## P2 — address for the public beta or narrow the advertised scope

### 11. Live sandbox and browser probes are blocked by the production CSP

`next.config.ts:23` allows connections only to self and Fontshare, while the sandbox and installation probe fetch arbitrary upstream/local origins. Chromium explicitly rejected the sample live fetch for violating `connect-src`. This occurs before CORS or API authentication can be tested. Cookie authentication cannot be faithfully sent through browser Fetch, which forbids setting Cookie headers.

Choose a supported local CLI test path, or design a deliberate origin-scoped live-testing capability. Do not add an unrestricted server proxy. Show the browser's CORS and private-network limitations honestly. Retain bounded consent for mutation tests.

### 12. The connection check fails against a healthy generated Node HTTP server

`src/lib/generator/client-config.ts:99` produces a bare GET via `curl --fail`. The generated Node HTTP server accepts POST and correctly answers GET with 405; this was reproduced against the running downloaded server. The browser probe marks every HTTP response as “passed” reachability, including an auth failure or unrelated 404.

Use protocol initialization, list-tools, and a safe tool call as separate checks. Label plain reachability as reachability. Include authorization and correct endpoint paths. Keep a self-attested completion checkbox visibly distinct from machine verification.

### 13. Schema conversion changes valid API contracts silently

`src/lib/generator/schema.ts:82` discards nullable, length/pattern/numeric constraints, and object additional-properties behavior in several cases. `{type: ["string", "null"]}` becomes `z.record(z.unknown())`, changing a nullable scalar into an object. `{type: "string", nullable: true, minLength: 5}` becomes `z.string()`. The Python regular-tool path relies on coarse hints and does not preserve equivalent nested validation.

Define a supported schema subset shared with capability reporting. Preserve constraints or explicitly flag the losses. Ensure Node/Python regular and compact mode make compatible decisions. Do not label partially supported contracts as fully ready.

### 14. Docker/cloud output has configuration and packaging failures

`src/lib/generator/targets/node.ts:1148` unconditionally copies `tests/`, but users can request Docker with Tests off, yielding no such directory. Both targets advertise `PORT` and `MCP_TRANSPORT` environment variables in generated Docker material but runtime startup uses generated fixed values; a Node process with `PORT=18763` still bound to its generated 8080. Localhost binding inside containers prevents published-port access. A stdio Python export has no HTTP access module/dependencies to switch to HTTP merely by setting an environment variable.

Make Docker inputs conditional; support validated host/port/transport environment values or remove the misleading controls. Test Docker builds with tests on/off. For cloud deployment, provide a real provider-specific entrypoint/configuration or remove that provider's deploy button. Static placeholder buttons are not a verified deployment workflow.

### 15. Generated upstream I/O lacks consistent bounds

`src/lib/generator/targets/node.ts:572` has no explicit request deadline, cancellation integration, response-size bound, or redirect policy. Python has a 30-second client timeout but buffers unbounded responses. `src/lib/sandbox/request.ts:173` checks length only after reading the full body, and counts JavaScript characters rather than bytes for its advertised 256 KiB cap. Sandbox multipart/binary serialization also differs from the real generated request functions.

Use stream-based byte budgets, clear deadlines, response/error redaction, and an intentional redirect policy. Never retry mutations implicitly. Share the actual request builder and response wrapping rules with inspection rather than maintaining a separate approximation.

### 16. Imported project files are only shallowly validated

`src/store/project-file.ts:57` accepts `spec: {apiModel: {}}`, empty configs, missing auth, and arbitrary tool elements. The helper accepted that exact malformed object. Import writes a snapshot before applying and normalizing the whole state, creating a risk of damaged persisted sessions. Export constructs a normalized generation plan during render without catching invalid state; the existing error-boundary component is unused.

Validate the full portable format, relationships, limits, and config enums before any write. Make import atomic, preserve the current session on failure, validate persisted sessions on hydration, and provide recovery/export/reset controls at route boundaries.

### 17. Mobile lacks preview and overflows on import

`src/app/export/page.tsx:936` makes the only file preview and Refresh button `hidden lg:flex`. At 320 px there is no visible preview action. Import's single-line tabs plus Import project bar produced a 360 px document at 320 px. Naming/saving controls in the shared header are desktop-only.

Add a mobile preview action/drawer, wrap or consolidate import actions, and provide project management on narrow screens. Verify 320/375/768/1024/1440 px and 200% zoom, including saved-history and error states.

### 18. Accessibility tests pass while actual controls fail

axe found eight endpoint rows with focusable descendants inside `role="button"`, an unnamed description textarea in the expanded editor, an unnamed project-file input on import, and Python badge contrast of 4.04:1 where 4.5:1 is required. Decorative homepage watermark numbers are also exposed as low-contrast text and should be hidden from assistive technology. The editor's “Status” label currently points at the description textarea, while the actual Description label is unassociated.

Use a distinct expand button beside endpoint selection, correctly bind labels, and resolve contrast with design tokens. The source-regex accessibility contract tests do not establish WCAG conformance. Add browser axe checks plus manual keyboard, focus, screen-reader, light-theme, and reduced-motion checks.

### 19. Regeneration resets a deliberate global auth choice

`src/store/project-store.ts:627` always re-infers `authConfig` when updating a spec, even though names/descriptions/visibility are preserved. Projects using a deliberate fallback auth override can silently switch behavior after regeneration.

Preserve user-set auth when still applicable; present an explicit auth drift review when source requirements change. Include server/auth settings in update summaries.

### 20. Privacy and supply-chain copy needs precision

The export footer says “Nothing is uploaded, stored, or shared” while the project is persisted to localStorage and saved to history. Clarify local storage versus server storage, retention, removal, optional URL/server generation, analytics, and external fonts. Do not imply that imported Postman examples cannot contain secrets.

The generated `mcpmint.dependencies.lock.json` and SBOM list direct dependencies; they are not package-manager-enforced transitive locks. Provenance is generated metadata, not signed independent build evidence. Registry declarations contain owner/package placeholders. Label these artifacts accurately and provide validated publish instructions. Describe an attestation as a hash-bound metadata scan record rather than proof that the whole archive is safe.

## UX changes that will improve activation

The ruled workbench, clear primary actions, endpoint grouping, read-only recommendations, browser privacy default, and in-place parameter editing fit a developer tool. Preserve that direction. The biggest improvement is reducing the work between download and the first successful client call.

1. **Choose the destination first:** “Use locally” or “Host remotely.” Default the first-use journey to Node + stdio + one tested client. Make Python, SSE, compact mode, and cloud settings progressive choices.
2. **Show a short progress checklist:** import validated → endpoints selected → metadata reviewed → archive generated → installed → connected → first call completed. Keep the downloadable archive stage distinct from readiness to serve traffic.
3. **Unify evidence:** one capability panel with actionable reasons, exact affected fields, and links to edit. Show transport/auth/schema limitations before a user spends time customizing tools.
4. **Make empty and failure states recoverable:** keep the previous project during a failed import, explain limits in plain language, focus the relevant field, and provide a recovery path when browser storage is unavailable.
5. **Use a runnable demo:** the bundled Petstore base URL is `https://petstore.example.com/api/v1`, a placeholder. Provide a clearly labeled local/mock demo or a documented working public API example so “Try the spec” can lead to a completed safe call.
6. **Replace the file-tab wall:** group source/runtime/docs/tests/artifacts in a file tree with a searchable filename selector and copy/download actions. Keep generated warnings adjacent to the file or tool they concern.
7. **Make risky controls explain their effect:** upstream API auth and MCP client auth are different. Explain them through who connects to whom. Avoid an unexplained numeric trust score or unexplained green “ready” badge.
8. **Expose support at failure points:** link to a generated-server issue template with generator version, language, transport, and sanitized error information. Never attach the user's spec or credentials automatically.

## Code quality and test strategy

The canonical model → plan → target pipeline is a useful architecture, and the SSRF-hardened URL proxy has specific defenses: private-address rejection, per-hop validation, pinned DNS, bounded response reads, and tests. Preserve the browser/server dependency boundary and the rule that public web generation does not install or execute generated processes.

The principal maintenance problem is duplicated interpretation: UI models, browser scan schemas, CLI scan schemas, token estimates, sandbox serialization, client installation metadata, and code generation can disagree. Consolidate these around a versioned normalized plan and installation manifest. Extract the 1,500-line export page and the 1,000-line store into modules with clear ownership after the correctness fixes. Avoid a broad rewrite before resolving the observed failures.

Prioritize tests of behavior at boundaries:

- Production browser flow for sample, file, paste, URL failure, portable import, red scan, mobile preview, and refresh recovery.
- Browser/CLI scan parity against nested metadata and normalized parameter names.
- Two new imports with identical source labels; regeneration as a separate operation; storage quota failure and malformed hydrated state.
- Generated Node/Python × regular/compact × stdio/HTTP plus supported SSE cases. Cover default origins, named/combined auth, nullable schemas, arrays, multipart, and different operation servers.
- Fresh-archive setup following only the displayed instructions; MCP initialize/list/call through the advertised clients.
- Docker with tests on/off; configurable bind/port; actual supported cloud deployment smoke checks.
- Dependency audit for app, CLI, and generated runtime; browser accessibility checks rather than source-string assertions alone.

## GTM recommendation

### Initial customer and promise

Start with developers who already have an OpenAPI API and want to use it from Claude Code or another validated local MCP client. They have a concrete source, can install Node, and can judge the generated request behavior. Do not start by promising enterprise-ready hosting or universal API compatibility.

Suggested product statement: **“Turn your OpenAPI or Postman API into MCP tools. Generate locally, inspect the requests, and connect to your client.”**

Use privacy and reviewability as differentiators, backed by demonstrations. Treat compact mode as an advanced benefit for larger supported APIs. Include a public support matrix explaining authentication, schema, file, endpoint-count, client, and transport limitations. Keep OSS/free positioning explicit if that is the intended business model; commercial pricing is a separate business decision, not a prerequisite to this OSS beta.

### Conversion assets

- A short demo ending in a real tool call, not a ZIP download.
- Three reproducible examples: read-only API, bearer-auth API, and Postman conversion.
- Dedicated quickstarts for the tested client/OS combinations, plus troubleshooting.
- An FAQ covering where specs are processed, where local projects live, remote fetches, supported auth, and generated-code verification limits.
- A comparison based on actual capabilities: direct conversion, local processing, manual endpoint selection, generated-code ownership, and limits. Avoid unsupported claims about competitors.
- A clear issue/support link and a compatibility/status page.

### Measurement

Instrument `import_started`, `import_succeeded`, `import_failed`, `selection_completed`, `preview_succeeded`, `generation_succeeded`, `generation_failed`, `installation_instructions_copied`, and user-reported `first_tool_call_completed`. If connection is self-reported, keep it labeled as such. Log durations, coarse input format, selected runtime/transport, and sanitized error codes. Never collect spec contents, endpoint names, URLs, tool descriptions, project names, credentials, or pasted input.

Use imported-project → first successful call as the activation metric. Downloads are an intermediate conversion. Track where users drop off, time to first call, error rate by supported combination, and returning use. Set baseline targets from the pilot; no user data exists here to justify invented adoption or conversion figures.

### Launch sequence

| Stage | Work | Exit condition |
| --- | --- | --- |
| Correctness | P1 issues; schema/CSP limitations; clean dependency triage; tests of actual default exports | Every supported path has a fresh-archive setup and completed tool call; project loss and scan mismatch are closed |
| Product beta | Mobile preview, accessibility, recovery, quickstart, runnable examples, precise trust/privacy wording | A new developer can complete the advertised journey using only the app/docs |
| Small pilot | Recruit 5–10 developers with real supported specs; observe setup; fix recurring friction | Repeated successful activation across supported inputs; failures understood and recoverable |
| Public beta | Publish demo/examples and support matrix; share in relevant MCP/developer communities; watch errors and support | Operator can detect failures, respond, and roll back without collecting customer specs |
| Expanded offering | Validate remote auth/client compatibility, cloud providers, Docker, schema breadth, and commercial demand | Broader claims have corresponding reproducible acceptance tests and customer evidence |

## Release checklist

- [ ] P1 findings resolved and reproduction cases retained in tests.
- [ ] Supported input/auth/schema/client matrix published; unsupported cases explained before download.
- [ ] Browser and CLI scan the same normalized exported metadata.
- [ ] Fresh Node/Python installs build and connect using visible instructions.
- [ ] Default exports pass their generated tests; real MCP calls pass.
- [ ] Mobile preview/project controls work at 320 px; keyboard and accessibility issues closed.
- [ ] Cloud/Docker claims narrowed to validated combinations.
- [ ] Local project creation, regeneration, deletion, undo, portable import, and storage-failure recovery validated.
- [ ] Dependency findings triaged; update automation and release checks cover app/CLI/generated output.
- [ ] Production shared rate limits configured and verified under the deployed platform's trusted-header behavior.
- [ ] Health, sanitized error reporting, alerts, incident owner, and rollback procedure ready.
- [ ] Canonical domain/metadata set; import has appropriate metadata; state-dependent editor/export pages excluded from indexing or given deliberate metadata.
- [ ] Privacy/support information and a runnable demo are public.
- [ ] Pilot activation evidence collected before expanding promotion.

## Evidence locations

All paths below are under `/workspace/mcpmint-review/evidence`:

- `mcpmint-build.log`, `mcpmint-generator-network.log`, `mcpmint-workflow-network.log`, `mcpmint-cli-network.log`, `mcpmint-generated-full.log`: build/test results.
- `mcpmint-export-install.log`, `mcpmint-runtime.log`: actual browser-downloaded archive tests and protocol call.
- `mcpmint-adversarial.log`, `recursive.openapi.json`: saved-project replacement and recursive-import failure.
- `scanner-mismatch.log`, `mcpmint-scan-probe.mts`: browser/CLI metadata scan mismatch.
- `mcpmint-mobile.log`, `mcpmint-mobile-import.png`, `mcpmint-mobile-editor.png`, `mcpmint-mobile-export.png`: mobile layout, preview availability, CSP failure, and local install instructions.
- `mcpmint-export.png`, `mcpmint-edge-flows.log`: desktop missing security/evidence sections, with measured disclosure state before and after opening. The exploratory log also includes a later script timeout; it is not treated as an application defect.
- `mcpmint-accessibility.json`: axe violations with selectors and affected elements.
- `mcpmint-audit.json`, `mcpmint-prod-audit.json`, `mcpmint-cli-audit.json`, `mcpmint-generated-audit.json`: exact registry audit responses.
- `mcpmint-code-probes.log`, `mcpmint-code-probes.mts`: schema loss, ignored operation servers, generated environment names, and Docker configuration.

The exploratory scripts use environment-specific executable/library paths and local mock credentials. They are review evidence, not a committed portable test suite. Preserve the behavior in maintainable repository tests when implementing fixes.
