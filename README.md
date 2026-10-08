# mcpmint — Generate MCP Servers in Your Browser

<div align="center">

**Generate MCP servers in your browser**

Generate MCP servers in your browser from OpenAPI and Postman specs. File/paste imports and browser generation stay on your device by default, and a token meter keeps servers lean. Free and open source.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)

</div>

---

## ✨ Features

- **Flexible import** — Upload a file, paste a spec (or ⌘V / Ctrl+V straight onto the landing page), or fetch from a URL. OpenAPI/Swagger and Postman v2.1 collections are all supported. URL fetches run through a server-side, SSRF-hardened proxy so browser CORS never blocks them, and one click loads a built-in Petstore sample.
- **Visual endpoint selection** — Choose which endpoints to expose as MCP tools.
- **Capability-aware selection** — See supported, manual-review, unsupported, auth, and risk classifications; start from Recommended, Read-only, CRUD, or All-supported presets.
- **Tool configuration** — Edit tool names, descriptions, and parameter details, with import-time validation warnings and per-endpoint review badges surfaced in the editor.
- **Trust Scan gate** — Scan tool metadata for hidden instructions, poisoning, suspicious parameters, broad permissions, and exfiltration combinations. Red results block download until explicit acknowledgement; export a SHA-256-bound attestation.
- **Request sandbox** — Inspect exact stored methods and paths and run no-network mocks. Execute bounded live tests locally through the CLI or generated server.
- **Project lifecycle** — Named local projects autosave, can be renamed/deleted/restored, and move between browsers as portable `.mcpmint.json` files.
- **Spec regeneration** — Import an updated spec into a project, preserve matching customizations, and review added, changed, and removed operation drift.
- 🪄 **Compact mode (meta-tools)** — For large APIs, emit just 3 meta-tools (`list_api_endpoints` / `get_api_endpoint_schema` / `invoke_api_endpoint`) instead of one tool per endpoint, keeping tool definitions from ballooning the model's context window. A live context-budget token meter shows the cost either way.
- 🔒 **Client-side generation** — File/paste imports, generation, and zipping run entirely in your browser by default (via fflate). URL imports use a hardened server fetch; web generation never installs dependencies or starts generated processes.
- **Multi-language export** — Generate Node.js (TypeScript) or Python (FastMCP) servers targeting MCP spec 2025-11-25.
- **Ready-to-run code** — Download a complete, deployable MCP server as a zip, then copy paste-ready client configs from the success screen.
- **Guided installation** — OS- and client-specific setup for Claude Desktop, Cursor, Claude Code, and VS Code, including exact config paths and connection checks.
- **Supply-chain evidence** — Every archive includes exact dependency/runtime pins, CycloneDX SBOM, license summary, update automation, build provenance, generator manifest, and registry metadata.
- **Session persistence** — Your in-progress import, selection, and configuration survive a page refresh.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/mcpmint/mcpmint.git
cd mcpmint

# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📖 How It Works

1. **Import** — Upload an OpenAPI/Swagger or Postman spec (JSON/YAML), paste it, or enter a URL (fetched server-side to bypass CORS). Try the built-in sample if you just want a look.
2. **Select** — Choose which endpoints to convert into MCP tools. Watch the context-budget meter, or flip on **compact mode** so a large API collapses into 3 meta-tools.
3. **Configure** — Edit tool names, descriptions, and parameters for better LLM understanding; review any validation warnings.
4. **Export** — Generate a complete MCP server in Node.js or Python. Generation stays in your browser by default. Then provide the extracted project&rsquo;s absolute path and copy the client config for Claude Desktop, Cursor, or the `claude mcp add` CLI. Run `mcpmint generate ./api.yaml --verify full` locally when you need install/build/runtime verification.

The CLI mirrors the safety workflow with `capabilities`, `scan`, and no-network-by-default `test` commands, plus endpoint/tag/method filters, JSON config files, dry-run plans, Trust Scan gating, attestations, tar/stdout output, atomic watch regeneration, and the same supply-chain output.

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Next.js 16](https://nextjs.org/) | React framework with App Router |
| [Tailwind CSS v4](https://tailwindcss.com/) | Refined brutalist design system with responsive product layouts |
| [shadcn/ui](https://ui.shadcn.com/) | UI components |
| [Zustand](https://zustand-demo.pmnd.rs/) | State management |
| [swagger-parser](https://apitools.dev/swagger-parser/) | OpenAPI specification parsing |
| [Zod](https://zod.dev/) | Request validation and generated Node parameter schemas |
| [fflate](https://github.com/101arrowz/fflate) | In-browser, dependency-free zip for client-side generation |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) 1.29.0 | MCP SDK used by generated Node.js servers |
| [FastMCP](https://github.com/jlowin/fastmcp) 3.4.2 | MCP framework used by generated Python servers |

## 📂 Project Structure

```
mcpmint/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Landing page
│   │   ├── import/page.tsx          # Import collection
│   │   ├── editor/page.tsx          # Endpoint selection
│   │   ├── export/page.tsx          # Server config + generate
│   │   └── api/
│   │       ├── generate/route.ts    # Server-side generate/preview
│   │       ├── fetch-spec/route.ts  # SSRF-hardened URL fetch proxy
│   │       └── health/route.ts      # Liveness probe
│   ├── components/
│   ├── lib/
│   │   ├── api/                     # Request guards + SSRF helpers
│   │   ├── client-generate.ts       # Browser-side generate + preview
│   │   ├── generator/               # Planner, targets, verify
│   │   └── parsers/                 # OpenAPI + Postman
│   └── store/                       # Zustand session store
├── cli/                             # npm package (mcpmint CLI)
├── pypi/                            # PyPI wrapper
└── package.json
```

## 🎯 Generated Server Features

Generated servers target the **MCP 2025-11-25** spec and include:

- **Current MCP SDKs** — `@modelcontextprotocol/sdk` 1.29.0 `registerTool` (Node) or FastMCP 3.4.2 (Python).
- **Type-safe parameters** — Zod schemas (Node) or Python type hints.
- **MCP 2025-11-25 features** — tool annotations (`readOnly` / `destructive` / `idempotent` / `openWorld`, derived from the HTTP verb), `outputSchema` + `structuredContent`, `isError` tool results for self-correcting failures, and stderr-only logging so the stdio JSON-RPC stream stays clean.
- **Compact mode (optional)** — for large APIs, exactly 3 meta-tools with safe dispatch: a closed, immutable operation registry, validate-before-I/O, stored method + path templates (no eval, no model-supplied URLs), and server-side auth.
- **Transport options** — Streamable HTTP by default, stdio for local clients, SSE as legacy.
- **Upstream authentication** — API Key, Bearer Token, or Basic Auth against the target API.
- **Hardened MCP access over HTTP/SSE** — in both Node and Python: optional bearer-token enforcement with a constant-time comparison, plus Origin enforcement that denies by default (only localhost origins are allowed when no allow-list is set) to guard against DNS-rebinding.
- **Registry- and deploy-ready** — a registry-ready `server.json` (npm for Node, PyPI for Python), a multi-stage `Dockerfile`, and one-click deploy buttons.
- **Environment config** — `.env.example` with all required variables.
- **Documentation** — README with setup, usage, and deploy instructions.

## 🔧 Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type check / lint / tests
npm run typecheck
npm run lint
npm run test:generator
```

## 🚀 Production configuration

Copy [`.env.example`](./.env.example) and set values in your host (e.g. Vercel):

| Variable | Purpose | Public deploy |
|----------|---------|---------------|
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for SEO/metadata | Set to your domain |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate limits across isolates | Recommended |
| `MCPMINT_RATE_LIMIT_MAX` | Requests per IP per minute (default 20) | Optional |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Public PostHog project token; enables product analytics | Optional |
| `NEXT_PUBLIC_POSTHOG_HOST` | Project API host: US `https://us.i.posthog.com`, EU `https://eu.i.posthog.com` | Required when analytics is enabled |

Health check: `GET /api/health`.

See [Vercel account migration and PostHog setup](docs/vercel-posthog-setup.md). PostHog uses explicit, filtered workflow events; automatic capture and recording are disabled. Public environment variables are compiled into the browser bundle, so redeploy after changing them.

Default product path generates **and previews in the browser** so specs do not hit the server. Server-side generation remains available when privacy mode is off, but both web paths perform only bounded structural validation. Full process verification is local CLI/CI-only.

## 🧭 Architecture

mcpmint is designed as a compiler-style generator:

```text
Source spec -> Canonical API model -> Tool plan -> Project plan -> Generated app -> Verification
```

See [docs/architecture.md](docs/architecture.md) for the target architecture and
ownership boundaries.

## 📄 License

MIT © [Tiwariji-07](https://github.com/Tiwariji-07)

---

<div align="center">

**[⭐ Star this repo](https://github.com/mcpmint/mcpmint)** if you find it useful!

</div>

### Production readiness and search discovery

See [deployment verification](docs/deployment-verification.md) for production browser checks, security header and rate-limit configuration, and post-deploy crawler/indexing checks. Public guides are served at `/docs`; `/llms.txt` indexes them for compatible agents. Editor and Export are session pages and excluded from search indexing.

Browser imports accept JSON/YAML specifications up to 5 MiB and 10,000 operations. Each server exports at most 500 selected tools. Processing, validation, preview and compression run in a dedicated worker, while the editor displays 100 endpoints per page. External schema references must be bundled locally before import. Portable project files have a separate 20 MiB budget. Sessions and named projects use IndexedDB, with migration from legacy localStorage and a visible recovery notice if browser storage fails.
