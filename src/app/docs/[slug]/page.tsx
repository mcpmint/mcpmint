import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingHeader } from "@/components/shared/marketing-header";
import { guides } from "@/lib/documentation";
import { SITE_URL } from "@/lib/site";
export const dynamicParams = false;
export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `${SITE_URL}/docs/${slug}` },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url: `${SITE_URL}/docs/${slug}`,
      type: "article",
    },
    twitter: { title: guide.title, description: guide.description },
  };
}
export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) notFound();
  const schema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: guide.title,
    description: guide.description,
    url: `${SITE_URL}/docs/${slug}`,
    inLanguage: "en",
    author: { "@type": "Organization", name: "mcpmint", url: SITE_URL },
    isPartOf: { "@type": "WebSite", name: "mcpmint", url: SITE_URL },
  };
  return (
    <>
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 pb-16 pt-28">
        <nav aria-label="Breadcrumb">
          <Link href="/docs" className="text-primary underline">
            Documentation
          </Link>
        </nav>
        <article>
          <h1 className="mt-6 text-4xl font-semibold leading-tight">
            {guide.title}
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            {guide.description}
          </p>
          {guide.sections.map((section) => (
            <section className="mt-10" key={section.title}>
              <h2 className="text-2xl font-semibold">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p
                  className="mt-4 leading-relaxed text-muted-foreground"
                  key={paragraph}
                >
                  {paragraph}
                </p>
              ))}
              {section.steps && (
                <ol className="mt-4 list-decimal space-y-3 pl-6">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </article>
        <nav
          aria-label="Related guides"
          className="mt-12 border-t border-border pt-6"
        >
          <h2 className="font-semibold">Related guides</h2>
          <ul className="mt-4 space-y-3">
            {guides
              .filter((item) => item.slug !== slug)
              .map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/docs/${item.slug}`}
                    className="text-primary underline"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
          </ul>
          <Link
            href="/import"
            className="mt-6 inline-block text-primary underline"
          >
            Start importing an API
          </Link>
        </nav>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
