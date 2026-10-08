// ---------------------------------------------------------------------------
// Shared request guards for public API routes (generate + fetch-spec).
//
// Goals:
//   1. Rate-limit by a platform-trusted client IP (not spoofable XFF first hop).
//   2. Cap request body size without relying solely on Content-Length.
//   3. Prefer a shared Upstash Redis limiter when configured; otherwise fall
//      back to a best-effort in-memory fixed window (per isolate only).
//
// This module intentionally avoids importing next/server so unit tests can
// load it under node:test without resolving Next's package export map.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const configuredRateLimit = Number(process.env.MCPMINT_RATE_LIMIT_MAX || 20);
const RATE_LIMIT_MAX_REQUESTS = Number.isInteger(configuredRateLimit) && configuredRateLimit > 0 ? configuredRateLimit : 20;

interface RateWindow {
    count: number;
    resetAt: number;
}

const memoryBuckets = new Map<string, RateWindow>();

/** Minimal header/IP surface used by getClientIp (NextRequest-compatible). */
export interface ClientIpSource {
    headers: { get(name: string): string | null };
    ip?: string | null;
}

/**
 * Extract a rate-limit key that is hard for a client to rotate freely.
 *
 * Trust order (most trusted first):
 *   1. `request.ip` when the runtime sets it (platform-provided).
 *   2. `x-vercel-forwarded-for` only when VERCEL=1.
 *   3. Rightmost XFF hop only on Vercel or with explicit trusted-proxy opt-in.
 *   4. `x-real-ip` ONLY when `MCPMINT_TRUST_X_REAL_IP=1` — many edges do not
 *      strip client-supplied x-real-ip, so trusting it by default enables
 *      rate-limit key rotation.
 *
 * Never use the leftmost XFF hop (client-controllable).
 */
export function getClientIp(request: ClientIpSource): string {
    if (request.ip) {
        return request.ip;
    }

    // Vercel-specific: connecting client IP (not spoofable by the request).
    const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.trim();
    if (process.env.VERCEL === "1" && vercelForwarded) {
        const first = vercelForwarded.split(",")[0]?.trim();
        if (first) {
            return first;
        }
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    if ((process.env.VERCEL === "1" || process.env.MCPMINT_TRUST_X_FORWARDED_FOR === "1") && forwardedFor) {
        const hops = forwardedFor
            .split(",")
            .map((hop) => hop.trim())
            .filter(Boolean);
        // Rightmost hop is the one closest to our edge (added by the platform).
        const last = hops[hops.length - 1];
        if (last) {
            return last;
        }
    }

    // Opt-in only: x-real-ip is spoofable unless a trusted proxy overwrites it.
    if (process.env.MCPMINT_TRUST_X_REAL_IP === "1") {
        const realIp = request.headers.get("x-real-ip")?.trim();
        if (realIp) {
            return realIp;
        }
    }

    return "unknown";
}

function memoryRateLimited(key: string): { limited: boolean; retryAfterSec: number } {
    const now = Date.now();
    const existing = memoryBuckets.get(key);

    if (!existing || now >= existing.resetAt) {
        memoryBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });

        if (memoryBuckets.size > 10_000) {
            for (const [bucketKey, window] of memoryBuckets) {
                if (now >= window.resetAt) {
                    memoryBuckets.delete(bucketKey);
                }
            }
        }

        if (memoryBuckets.size > 10_000) memoryBuckets.delete(memoryBuckets.keys().next().value!);
        return { limited: false, retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) };
    }

    existing.count += 1;
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
        limited: existing.count > RATE_LIMIT_MAX_REQUESTS,
        retryAfterSec,
    };
}

/**
 * Upstash REST rate limit (optional). Set:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */
async function upstashRateLimited(
    key: string
): Promise<{ limited: boolean; retryAfterSec: number } | null> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        return null;
    }

    const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    const redisKey = `mcpmint:rl:${key}:${bucket}`;
    const windowSec = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

    try {
        const response = await fetch(`${url}/pipeline`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify([
                ["INCR", redisKey],
                ["EXPIRE", redisKey, String(windowSec)],
            ]),
            signal: AbortSignal.timeout(1500),
        });

        if (!response.ok) {
            return null;
        }

        const results = (await response.json()) as Array<{ result?: number | string }>;
        const count = Number(results?.[0]?.result ?? 0);
        return {
            limited: count > RATE_LIMIT_MAX_REQUESTS,
            retryAfterSec: windowSec,
        };
    } catch {
        return null;
    }
}

export interface RateLimitResult {
    limited: boolean;
    retryAfterSec: number;
    ip: string;
}

export async function checkRateLimit(
    request: ClientIpSource,
    route: string
): Promise<RateLimitResult> {
    const ip = getClientIp(request);
    const key = `${route}:${ip}`;

    const remote = await upstashRateLimited(key);
    const result = remote ?? memoryRateLimited(key);

    return {
        limited: result.limited,
        retryAfterSec: result.retryAfterSec,
        ip,
    };
}

export class PayloadTooLargeError extends Error {
    constructor(message = "Request payload too large.") {
        super(message);
        this.name = "PayloadTooLargeError";
    }
}

/** Minimal body stream surface (NextRequest / Request-compatible). */
export interface ReadableBodySource {
    headers: { get(name: string): string | null };
    body: ReadableStream<Uint8Array> | null;
}

/**
 * Read and parse a JSON body with a hard byte budget. Does not trust
 * Content-Length alone: streams the body and aborts past maxBytes.
 */
export async function readJsonBodyCapped<T = unknown>(
    request: ReadableBodySource,
    maxBytes: number
): Promise<T> {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new PayloadTooLargeError();
    }

    const body = request.body;
    if (!body) {
        return JSON.parse("") as T;
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
                if (total > maxBytes) {
                    throw new PayloadTooLargeError();
                }
                chunks.push(value);
            }
        }
    } finally {
        reader.cancel().catch(() => {});
    }

    const text = Buffer.concat(chunks).toString("utf-8");
    return JSON.parse(text) as T;
}
