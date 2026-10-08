import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/shared/marketing-header";
import { SITE_URL } from "@/lib/site";
import { guides } from "@/lib/documentation";
const description =
  "Guides to converting OpenAPI, Swagger and Postman collections into MCP servers, with privacy, processing limits and deployment instructions.";
export const metadata: Metadata = {
  title: "MCP server generation documentation",
  description,
  alternates: { canonical: `${SITE_URL}/docs` },
  openGraph: {
    title: "mcpmint documentation",
    description,
    url: `${SITE_URL}/docs`,
  },
  twitter: { title: "mcpmint documentation", description },
};
export default function DocsPage() {
  return (
    <>
      <MarketingHeader />
      <main className="mx-auto max-w-4xl px-6 pb-16 pt-28">
        <h1 className="text-4xl font-semibold">mcpmint documentation</h1>
        <p className="mt-6 text-muted-foreground leading-relaxed">
          Convert API contracts into inspectable Model Context Protocol servers.
          These guides explain what mcpmint supports, how your specification is
          processed, and what to review before connecting an AI client.
        </p>
        <div className="mt-10 space-y-6">
          {guides.map((guide) => (
            <article key={guide.slug} className="border border-border p-6">
              <h2 className="text-xl font-semibold">
                <Link
                  className="text-primary underline underline-offset-4"
                  href={`/docs/${guide.slug}`}
                >
                  {guide.title}
                </Link>
              </h2>
              <p className="mt-3 text-muted-foreground">{guide.description}</p>
            </article>
          ))}
        </div>
        <p className="mt-10">
          <Link href="/import" className="text-primary underline">
            Import a specification
          </Link>{" "}
          ·{" "}
          <a href="https://github.com/mcpmint/mcpmint" className="underline">
            Source code on GitHub
          </a>
        </p>
      </main>
    </>
  );
}
