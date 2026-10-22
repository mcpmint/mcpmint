# mcpmint

Generate [MCP](https://modelcontextprotocol.io) servers from OpenAPI and Postman specs — locally, from your terminal. **Your spec never leaves your machine.**

```bash
npx @mcpmint/cli generate ./petstore.json
```

## What it does

Point it at an OpenAPI/Swagger (JSON or YAML) or Postman collection and it emits a standalone, ready-to-run MCP server project — in TypeScript (`@modelcontextprotocol/sdk`) or Python (FastMCP) — with per-operation tools, MCP 2025-11-25 tool annotations, structured output, upstream-auth wiring, tests, and a README. You own the output; there is no account, no upload, no lock-in.

## Usage

```bash
# Summarize a spec: endpoints, detected auth, and the context-token budget
mcpmint inspect ./petstore.json

# Classify operation support, auth, and risk before selecting tools
mcpmint capabilities ./petstore.json

# Run all five Trust Scan checks and optionally write an attestation
mcpmint scan ./petstore.json --attestation ./trust-attestation.json

# Inspect a generated request and MCP envelope without making a network call
mcpmint test ./petstore.json --operation listPets

# Generate a TypeScript server over HTTP
mcpmint generate ./petstore.json --lang node --transport http --out ./petstore-mcp

# Generate a Python server, compact mode (3 meta-tools for large APIs)
mcpmint generate ./api.yaml --lang python --compact

# Verify the generated project actually installs, builds, and runs
mcpmint generate ./petstore.json --verify full

# Generate only the safe recommended set; red scans require explicit acceptance
mcpmint generate ./petstore.json --preset recommended --attestation ./trust.json

# Filter by tag/method and inspect the plan without writing files
mcpmint generate ./petstore.json --tag pets --method GET --dry-run

# Produce a deterministic tar container, or stream it into another command
mcpmint generate ./petstore.json --format tar --out ./petstore-mcp.tar.gz
mcpmint generate ./petstore.json --stdout > petstore-mcp.tar.gz

# Regenerate atomically whenever the source spec changes
mcpmint generate ./petstore.json --out ./petstore-mcp --watch
```

### `generate` options

| Option | Values | Default |
| --- | --- | --- |
| `--lang` | `node`, `python` | `node` |
| `--transport` | `stdio`, `http`, `sse` | `stdio` |
| `--out` | directory | `./<server-name>` |
| `--name` | string | derived from spec title |
| `--compact` | flag | off |
| `--preset` | `recommended`, `read-only`, `crud`, `all-supported` | `all-supported` |
| `--operation` | operation ID; repeatable | — |
| `--tag`, `--method` | repeatable endpoint filters | — |
| `--package-manager` | `npm`, `pnpm`, `yarn` | `npm` |
| `--host` / `--port` | host / 1–65535 | `localhost` / `8080` |
| `--verify` | `off`, `fast`, `full` | `fast` |
| `--no-tests`, `--no-docs`, `--docker` | flags | — |
| `--force` | overwrite non-empty output dir | off |
| `--accept-risk` | acknowledge and proceed after a red Trust Scan | off |
| `--attestation` | Trust Scan attestation output file | — |
| `--mcp-auth`, `--origin` | MCP bearer access and browser allow-list | none / localhost-only |
| `--config` | JSON defaults file | — |
| `--dry-run` | print the resolved plan; write nothing | off |
| `--format`, `--stdout` | `dir`, reproducible `tar`, or tar.gz bytes | `dir` |
| `--watch` | atomically regenerate on spec changes | off |

`--verify full` runs a real install + build + import + test of the generated project on your machine — the one check the [browser app](https://github.com/mcpmint/mcpmint) can't do.

`mcpmint test` is a mock by default. Add `--live` to call the imported base origin; mutation methods additionally require `--allow-mutation`.

### Config file

Every generate default can live in a JSON file and command-line flags take precedence:

```json
{
  "lang": "node",
  "transport": "http",
  "host": "0.0.0.0",
  "mcpAuth": "bearer",
  "origins": ["https://client.example.com"],
  "preset": "recommended",
  "tags": ["pets"],
  "verify": "full",
  "docker": true
}
```

```bash
mcpmint generate ./petstore.json --config ./mcpmint.config.json
```

## Also available in the browser

Prefer a UI? The same generator, with a visual endpoint editor and live token meter, runs at [mcpmint](https://github.com/mcpmint/mcpmint) — entirely client-side, spec never uploaded.

## License

MIT
