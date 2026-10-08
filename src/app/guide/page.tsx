import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { MarketingHeader } from "@/components/shared/marketing-header";
export const metadata: Metadata = { title: "Local quickstart and compatibility", description: "Run a local mock API, generate MCP tools, and verify your first call. Supported features and limitations.", alternates: { canonical: `${SITE_URL}/guide` } };
export default function Guide() {
  return <><MarketingHeader /><main className="mx-auto max-w-3xl space-y-8 px-6 pb-20 pt-28">
    <h1 className="text-3xl font-semibold">Your first MCP tool call</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">Start with Node + stdio and a local MCP client. No account is required. The bundled examples call a mock API on your own computer.</p>
    <ol className="list-decimal space-y-5 pl-5 text-sm leading-relaxed">
      <li>Clone the <a className="text-primary underline" href="https://github.com/mcpmint/mcpmint">mcpmint repository</a>, then run <code>node scripts/demo-api.mjs</code> with Node 22 or later. Keep that terminal running. Check <code>http://127.0.0.1:8787/ping</code>.</li>
      <li>Download an example below and <Link className="text-primary underline" href="/import">import it</Link>. Select the GET tool. Choose the Local Claude Desktop preset on Export. You can also select Claude Code in the installation wizard.</li>
      <li>Download and extract the archive. In its folder run <code>npm install</code>, then <code>npm run build</code>. Copy <code>.env.example</code> to <code>.env</code>. Fill the required credentials for the bearer example.</li>
      <li>Enter the extracted folder’s absolute path in the wizard. Copy the generated configuration or registration command into your client. For the bearer example replace <code>BEARER_AUTH_TOKEN</code> with the mock credential <code>demo-token</code> in your local client configuration. This credential belongs only to this local demo.</li>
      <li>Restart the client, list tools, then call <code>ping</code>. The response should contain <code>status: ok</code>. MCP Inspector provides another way to initialize, list, and call the generated server. A completed tool call is the activation checkpoint.</li>
    </ol>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Reproducible examples</h2><div className="flex flex-wrap gap-4 text-sm text-primary underline">
      <a href="/samples/read-only.json" download>Read-only OpenAPI</a><a href="/samples/bearer.json" download>Bearer-auth OpenAPI</a><a href="/samples/demo.postman.json" download>Postman collection</a>
    </div><p className="text-xs text-muted-foreground">The Petstore example uses the same local mock. It provides read-only responses; its write contracts are for inspection. Upstream demo credentials are simulated for Petstore.</p></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Supported scope</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="py-2 pr-4">Feature</th><th className="py-2">Scope and limits</th></tr></thead><tbody>
      {[
        ["Input", "OpenAPI 3.x, Swagger 2, and Postman JSON/YAML. Local files up to 5 MB. Internal references are resolved. External references must be bundled; recursive reference edges stay finite and require manual review."],
        ["Runtime", "Generated Node and Python projects are installed and tested in CI. Node 22+; Python 3.11+. Regular and compact tools use the same operations."],
        ["Schema", "Scalar/null unions, nested objects, arrays, common bounds and additional-properties policies. Composition and unsupported keywords receive manual-review warnings. OneOf exclusivity needs review in Node."],
        ["Upstream auth", "Named API keys, bearer tokens and Basic credentials. Operation requirements govern generated requests. OAuth token acquisition is not included."],
        ["Transport", "Stdio for local clients; HTTP and legacy SSE are available. Python HTTP uses /mcp. Remote clients need the correct URL and headers."],
        ["Client setup", "Claude Desktop local JSON, Claude Code registration, Cursor JSON and VS Code JSON are provided. Real client/OS certification is pending; verify a tool call on your chosen combination. Remote Claude Desktop requires separate connector setup."],
        ["Hosting", "Docker files use the selected transport. Provider adapters and one-click cloud deploys are not included. Validate HTTPS, secrets and access before exposure."],
        ["Testing", "Browser inspection and mocks stay local. Send real requests through the generated server or local CLI. Metadata scans are heuristics, not security certification."],
      ].map(([feature, scope]) => <tr key={feature} className="border-b border-border"><td className="py-3 pr-4 align-top font-medium">{feature}</td><td className="py-3 text-muted-foreground">{scope}</td></tr>)}
    </tbody></table></div></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Troubleshooting</h2><p className="text-sm text-muted-foreground">Missing dist/src/index.js: run the build. Python import errors: use the .venv interpreter. HTTP 401: check the named upstream credentials and the separate MCP access token. Browser storage failure: download the generated archive or portable project as a backup. Remote connection failure: check your reachable URL, endpoint path, HTTPS and client support.</p><a className="text-sm text-primary underline" href="https://github.com/mcpmint/mcpmint/issues/new?template=generated_server_problem.yml" target="_blank" rel="noopener noreferrer">Report a generated-server problem</a><p className="text-xs text-muted-foreground">Include generator version, runtime, transport and a sanitized error. Review attachments; do not post private specs or credentials.</p></section>
    <Link href="/privacy" className="text-sm text-primary underline">How processing and local storage work</Link>
  </main></>;
}
