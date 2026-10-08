import type { NextConfig } from "next";

// Baseline security headers for all routes (finding L2).
//
// The CSP keeps the minimum allowances needed by the statically rendered app:
// - Fontshare CSS is loaded via <link rel="stylesheet"> from api.fontshare.com
//   and served fonts from fonts fontshare CDN, so those hosts are allowlisted
//   for style/font.
// - Next.js static output injects inline bootstrap/style data, so unsafe-inline
//   remains until the app moves to nonce-based dynamic rendering or Webpack SRI.
// - unsafe-eval is development-only; React/Next do not require it in production.
const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' https://cdn.fontshare.com https://api.fontshare.com data:",
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://cdn.fontshare.com",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // Live tests are explicitly initiated and enforce the imported base origin in code.
    // CORS still applies. Local connection checks target loopback development servers.
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
    async headers() {
        return [
            {
                source: "/:path*",
                headers: securityHeaders,
            },
        ];
    },
};

export default nextConfig;
