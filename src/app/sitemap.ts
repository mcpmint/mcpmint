import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { guides } from "@/lib/documentation";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/import",
    "/guide",
    "/privacy",
    "/docs",
    ...guides.map((guide) => `/docs/${guide.slug}`),
  ].map((path) => ({ url: `${SITE_URL}${path}` }));
}
