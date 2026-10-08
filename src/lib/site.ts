function siteOrigin(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute site origin."); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error("NEXT_PUBLIC_SITE_URL must contain only an http(s) origin, without credentials, a path, query, or fragment.");
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error("The public site origin must use HTTPS.");
    return url.origin;
}
// Explicit canonical origin wins; deployment domains support new Vercel accounts.
export const SITE_URL = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    || "http://localhost:3000");
