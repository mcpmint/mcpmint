import type { Metadata } from "next";
import HomeClient from "./home-client";
import { SITE_URL } from "@/lib/site";
export const metadata: Metadata = { alternates: { canonical: SITE_URL } };
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "mcpmint",
      url: SITE_URL,
      sameAs: ["https://github.com/mcpmint/mcpmint"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "mcpmint",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#application`,
      name: "mcpmint",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web browser",
      url: SITE_URL,
      description:
        "Convert OpenAPI, Swagger and Postman collections into inspectable Model Context Protocol servers. Parse local files in a browser worker and export TypeScript or Python source code.",
      featureList: [
        "OpenAPI and Postman import",
        "TypeScript and Python MCP server generation",
        "Local file processing",
        "Tool inspection and trust scan",
        "stdio, SSE and Streamable HTTP transport",
      ],
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};
export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HomeClient />
    </>
  );
}
