import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
export const metadata: Metadata = {
  title: "Import an API specification",
  description:
    "Import an OpenAPI, Swagger or Postman JSON/YAML specification, paste content, fetch a public URL, or restore a portable mcpmint project.",
  alternates: { canonical: `${SITE_URL}/import` },
  openGraph: {
    title: "Import an API specification | mcpmint",
    description:
      "Import an OpenAPI, Swagger or Postman JSON/YAML specification, paste content, fetch a public URL, or restore a portable mcpmint project.",
    url: `${SITE_URL}/import`,
  },
  twitter: {
    title: "Import an API specification | mcpmint",
    description:
      "Import an OpenAPI, Swagger or Postman JSON/YAML specification, paste content, fetch a public URL, or restore a portable mcpmint project.",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
