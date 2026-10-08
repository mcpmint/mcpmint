// Canonical site origin, used for metadataBase, Open Graph URLs, canonical
// links, robots.txt, and the sitemap. When the production domain changes
// (e.g. after buying a custom domain), set NEXT_PUBLIC_SITE_URL in the
// deployment environment — no code change needed.
// NOTE: the make-mcp.vercel.app fallback is the live deployment and is kept
// deliberately; the mcpmint domain swap happens later via NEXT_PUBLIC_SITE_URL.
function siteOrigin(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute site origin."); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error("NEXT_PUBLIC_SITE_URL must contain only an http(s) origin, without credentials, a path, query, or fragment.");
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error("The public site origin must use HTTPS.");
    return url.origin;
}
export const SITE_URL = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL || "https://make-mcp.vercel.app");
