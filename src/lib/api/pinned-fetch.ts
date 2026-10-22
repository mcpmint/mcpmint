import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * HTTP(S) GET that connects to a pre-validated IP while preserving the
 * original hostname for Host / SNI. This closes the DNS-rebinding TOCTOU
 * where resolve-then-fetch(hostname) can hit a different address.
 *
 * Uses Node's request `lookup` override so the socket is always dialed to
 * `pinnedIp` and never re-resolves the hostname.
 */
export async function pinnedGet(
    url: URL,
    pinnedIp: string,
    init: {
        signal?: AbortSignal;
        headers?: Record<string, string>;
    } = {}
): Promise<Response> {
    const family = isIP(pinnedIp);
    if (family !== 4 && family !== 6) {
        throw new TypeError("pinnedIp must be a valid IPv4 or IPv6 address.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new TypeError("Only http and https are supported.");
    }

    const transport = url.protocol === "https:" ? https : http;
    const headers = { ...(init.headers || {}) };

    // Ensure Host is the original authority (virtual hosts / TLS SNI rely on it).
    if (!headers.Host && !headers.host) {
        headers.Host = url.host;
    }

    return new Promise<Response>((resolve, reject) => {
        if (init.signal?.aborted) {
            reject(abortError());
            return;
        }

        const req = transport.request(
            {
                protocol: url.protocol,
                // hostname drives default Host / SNI; connection target is forced via lookup.
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: "GET",
                headers,
                servername: url.protocol === "https:" ? url.hostname.replace(/^\[|\]$/g, "") : undefined,
                // Node 18–22 may call lookup with either the classic
                // (err, address, family) shape or the all:true shape
                // (err, addresses[]). Support both so the pin never fails open.
                lookup: ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
                    const opts = options as { all?: boolean } | undefined;
                    if (opts && opts.all === true) {
                        callback(null, [{ address: pinnedIp, family }]);
                        return;
                    }
                    callback(null, pinnedIp, family);
                }) as typeof import("node:dns").lookup,
            },
            (incoming) => {
                try {
                    resolve(incomingMessageToFetchResponse(incoming));
                } catch (error) {
                    incoming.destroy();
                    reject(error);
                }
            }
        );

        const onAbort = () => {
            req.destroy(abortError());
        };

        if (init.signal) {
            init.signal.addEventListener("abort", onAbort, { once: true });
        }

        req.on("error", (error) => {
            if (init.signal) {
                init.signal.removeEventListener("abort", onAbort);
            }
            reject(error);
        });

        req.end();
    });
}

function abortError(): Error {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
}

// The Response constructor throws if these statuses get a body.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function incomingMessageToFetchResponse(incoming: IncomingMessage): Response {
    const status = incoming.statusCode || 0;
    const statusText = incoming.statusMessage || "";

    // Collect headers; Node may use string | string[].
    const headerInit: Record<string, string> = {};
    for (const [key, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        headerInit[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    if (NULL_BODY_STATUSES.has(status)) {
        incoming.resume();
        return new Response(null, { status, statusText, headers: headerInit });
    }

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            incoming.on("data", (chunk: Buffer | string) => {
                const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
                controller.enqueue(new Uint8Array(bytes));
            });
            incoming.on("end", () => {
                controller.close();
            });
            incoming.on("error", (error) => {
                controller.error(error);
            });
        },
        cancel() {
            incoming.destroy();
        },
    });

    return new Response(stream, {
        status,
        statusText,
        headers: headerInit,
    });
}
