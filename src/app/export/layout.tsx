import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
export const metadata: Metadata = {
  title: "Export your MCP server",
  description:
    "Review, test and export the MCP server configured in this browser.",
  alternates: { canonical: `${SITE_URL}/export` },
  openGraph: {
    title: "Export your MCP server | mcpmint",
    description:
      "Review, test and export the MCP server configured in this browser.",
    url: `${SITE_URL}/export`,
  },
  twitter: {
    title: "Export your MCP server | mcpmint",
    description:
      "Review, test and export the MCP server configured in this browser.",
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
