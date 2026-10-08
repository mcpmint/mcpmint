import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
export const metadata: Metadata = {
  title: "Configure your MCP tools",
  description:
    "Configure tools for the API specification saved in this browser.",
  alternates: { canonical: `${SITE_URL}/editor` },
  openGraph: {
    title: "Configure your MCP tools | mcpmint",
    description:
      "Configure tools for the API specification saved in this browser.",
    url: `${SITE_URL}/editor`,
  },
  twitter: {
    title: "Configure your MCP tools | mcpmint",
    description:
      "Configure tools for the API specification saved in this browser.",
  },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
