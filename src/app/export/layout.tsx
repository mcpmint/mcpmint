import type { Metadata } from "next";
export const metadata: Metadata = { title: "Generate your server", robots: { index: false, follow: false } };
export default function ExportLayout({ children }: { children: React.ReactNode }) { return children; }
