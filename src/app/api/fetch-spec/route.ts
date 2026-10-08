import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIp } from "@/lib/api/ssrf";
import { pinnedGet } from "@/lib/api/pinned-fetch";
import {
    checkRateLimit,
    PayloadTooLargeError,
    readJsonBodyCapped,
} from "@/lib/api/request-guards";

// ---------------------------------------------------------------------------
// Server-side spec-fetch proxy
// ---------------------------------------------------------------------------
// PURPOSE: Fetch a user-supplied OpenAPI/Swagger/Postman spec URL SERVER-SIDE
// so the browser is not blocked by CORS. We return the RAW spec TEXT to the
// client; parsing stays client-side (same pipeline as the file/paste tabs).
//
// SECURITY (SSRF): This route makes outbound requests to attacker-controllable
// URLs, so it is an SSRF sink and is hardened accordingly:
//   1. Scheme allowlist  — only http/https.
//   2. IP validation     — resolved address(es) checked against private/reserved
//      ranges, including IPv4-mapped IPv6 hex forms (::ffff:7f00:1).
//   3. DNS pin           — the socket is dialed to the validated IP via a custom
//      lookup; the hostname is NOT re-resolved at connect time (closes
//      rebinding TOCTOU between assertUrlIsSafe and fetch).
//   4. Redirects         — manual follow with per-hop revalidation + hop cap.
//   5. Size cap          — response body streamed and aborted past MAX_SPEC_BYTES.
//   6. Timeout           — per-request AbortController.
//   7. Rate limit        — shared limiter (Upstash if configured, else memory).
//   8. Clean errors      — no internal hostnames/IPs/stack traces.
// ---------------------------------------------------------------------------

const MAX_SPEC_BYTES = 5 * 1024 * 1024; // 5MB
const REQUEST_TIMEOUT_MS = 10_000; // 10s
const MAX_REDIRECTS = 5;
const MAX_INCOMING_BODY_BYTES = 16 * 1024; // the incoming { url } body is tiny

export const maxDuration = 15;

class BlockedUrlError extends Error {}

/** A URL whose host has been resolved and pinned to a single safe address. */
interface SafeTarget {
    url: URL;
    /** Validated IP that the socket will connect to (no second DNS lookup). */
    pinnedIp: string;
}

/**
 * Validate a URL for SSRF safety and return a pinned target.
 * Scheme allowlist + resolve host; reject if any resolved address is private.
 * The returned pinnedIp is used for the actual TCP connection.
 */
function withAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException("Request timed out.", "AbortError"));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Request timed out.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

async function assertUrlIsSafe(rawUrl: string, signal: AbortSignal): Promise<SafeTarget> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new BlockedUrlError("Invalid URL.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new BlockedUrlError("Only http and https URLs are allowed.");
    }

    const hostname = url.hostname;
    if (!hostname) {
        throw new BlockedUrlError("URL is missing a host.");
    }

    // If the host is already an IP literal, validate and pin to it directly.
    const literalHost = hostname.replace(/^\[|\]$/g, "");
    if (isIP(literalHost)) {
        if (isBlockedIp(literalHost)) {
            throw new BlockedUrlError("URL resolves to a blocked address.");
        }
        return { url, pinnedIp: literalHost };
    }

    // Otherwise resolve the hostname to its IP(s) and validate EVERY one.
    // Fail closed if any address is private/reserved (mixed public+private is
    // treated as blocked — common rebinding staging pattern).
    let addresses: { address: string; family: number }[];
    try {
        addresses = await withAbort(lookup(hostname, { all: true }), signal);
    } catch {
        if (signal.aborted) throw new DOMException("Request timed out.", "AbortError");
        throw new BlockedUrlError("Could not resolve the host.");
    }

    if (addresses.length === 0) {
        throw new BlockedUrlError("Could not resolve the host.");
    }

    for (const { address } of addresses) {
        if (isBlockedIp(address)) {
            throw new BlockedUrlError("URL resolves to a blocked address.");
        }
    }

    // Prefer IPv4 for the pin (broader reachability); fall back to first entry.
    const preferred = addresses.find((entry) => entry.family === 4) || addresses[0];
    return { url, pinnedIp: preferred.address };
}

/** Detect a content hint from the URL/content-type to help the client. */
function detectContentHint(contentType: string | null, url: string): "json" | "yaml" | "unknown" {
    const ct = (contentType || "").toLowerCase();
    if (ct.includes("json")) return "json";
    if (ct.includes("yaml") || ct.includes("yml")) return "yaml";
    const lower = url.toLowerCase();
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    return "unknown";
}

/** Read a response body, aborting if it exceeds the size cap. */
async function readCappedBody(response: Response): Promise<string> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_SPEC_BYTES) {
        throw new BlockedUrlError("Spec is too large.");
    }

    const body = response.body;
    if (!body) {
        return "";
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                total += value.byteLength;
                if (total > MAX_SPEC_BYTES) {
                    throw new BlockedUrlError("Spec is too large.");
                }
                chunks.push(value);
            }
        }
    } finally {
        reader.cancel().catch(() => {});
    }

    return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Fetch a URL with manual redirect handling. Each hop is anti-SSRF-validated
 * and the TCP connection is pinned to the validated IP (no DNS rebinding window).
 */
async function safeFetch(start: SafeTarget, signal: AbortSignal): Promise<Response> {
    let current = start;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await pinnedGet(current.url, current.pinnedIp, {
            signal,
            headers: {
                Accept: "application/json, application/yaml, text/yaml, text/plain, */*",
                "User-Agent": "mcpmint-spec-fetcher/1.0",
            },
        });

        const status = response.status;
        const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

        if (!isRedirect) {
            return response;
        }

        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});

        if (!location) {
            throw new BlockedUrlError("Upstream returned a redirect without a location.");
        }
        if (hop === MAX_REDIRECTS) {
            throw new BlockedUrlError("Too many redirects.");
        }

        // Resolve relative redirects against the current URL, then re-validate
        // and re-pin before following.
        const nextUrl = new URL(location, current.url);
        current = await assertUrlIsSafe(nextUrl.toString(), signal);
    }

    throw new BlockedUrlError("Too many redirects.");
}

export async function POST(request: NextRequest) {
    const rate = await checkRateLimit(request, "fetch-spec");
    if (rate.limited) {
        return NextResponse.json(
            { error: "Too many requests. Please slow down and try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
        );
    }

    let url: string;
    try {
        const body = await readJsonBodyCapped<{ url?: unknown }>(request, MAX_INCOMING_BODY_BYTES);
        if (typeof body.url !== "string" || !body.url.trim()) {
            return NextResponse.json({ error: "A spec URL is required." }, { status: 400 });
        }
        url = body.url.trim();
    } catch (error) {
        if (error instanceof PayloadTooLargeError) {
            return NextResponse.json({ error: "Request payload too large." }, { status: 413 });
        }
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const safeTarget = await assertUrlIsSafe(url, controller.signal);
        const response = await safeFetch(safeTarget, controller.signal);

        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return NextResponse.json(
                { error: `The spec URL responded with status ${response.status}.` },
                { status: 502 }
            );
        }

        const text = await readCappedBody(response);

        if (!text.trim()) {
            return NextResponse.json({ error: "The spec URL returned an empty response." }, { status: 502 });
        }

        const hint = detectContentHint(response.headers.get("content-type"), safeTarget.url.toString());
        return NextResponse.json({ content: text, contentHint: hint });
    } catch (error) {
        if (error instanceof BlockedUrlError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof Error && error.name === "AbortError") {
            return NextResponse.json({ error: "The spec URL timed out." }, { status: 504 });
        }
        return NextResponse.json({ error: "Could not fetch the spec URL." }, { status: 502 });
    } finally {
        clearTimeout(timeout);
    }
}
