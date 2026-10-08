import { SITE_URL } from "@/lib/site";
import { guides } from "@/lib/documentation";
export const dynamic = "force-static";
export function GET() {
  const text = `# mcpmint\n\n> An open-source browser application that converts OpenAPI, Swagger and Postman collections into inspectable TypeScript or Python Model Context Protocol servers.\n\nLocal file parsing, preview and ZIP generation run in a browser worker by default. URL import uses a server fetch proxy. Explicitly disabling browser generation uploads the configured model to the generation API. Live sandbox execution sends real requests to the imported API origin. Trust Scan is heuristic, not a security certification.\n\n## Documentation\n\n- [Documentation index](${SITE_URL}/docs)\n${guides.map((guide) => `- [${guide.title}](${SITE_URL}/docs/${guide.slug}): ${guide.description}`).join("\n")}\n\n## Application\n\n- [Home](${SITE_URL})\n- [Import an API](${SITE_URL}/import)\n- [Source code](https://github.com/mcpmint/mcpmint)\n\nEditor and Export require a local browser session and are excluded from indexing.\n`;
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
