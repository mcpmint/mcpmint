import { NextRequest, NextResponse } from "next/server";
import { createServerArchive, createServerPreview } from "@/lib/generator/server";
import { sanitizeRootFolder } from "@/lib/generator/archive";
import { parseGeneratorRequestPayload } from "@/lib/generator/request";
import type { GeneratorRequest } from "@/lib/generator/types";
import {
    checkRateLimit,
    PayloadTooLargeError,
    readJsonBodyCapped,
} from "@/lib/api/request-guards";

// Reject oversized payloads before parsing. ~5MB is generous for realistic API
// specs; the body is streamed with a hard byte budget (not Content-Length alone).
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Keep generate/preview within a predictable serverless budget. Process-spawning
// verification is off by default on the public path, so this stays short.
export const maxDuration = 60;

/**
 * The HTTP generation path never spawns tsc/npm/pip. Full process verification
 * is intentionally CLI-only so an untrusted request cannot consume arbitrary
 * install/build resources on the server.
 */
function applyPublicVerificationPolicy(body: GeneratorRequest): GeneratorRequest {
    return {
        ...body,
        exportConfig: {
            ...body.exportConfig,
            // Force off process-based verification on the public path.
            verificationMode: "fast",
            features: {
                ...body.exportConfig.features,
                verification: false,
            },
        },
    };
}

export async function POST(request: NextRequest) {
    const rate = await checkRateLimit(request, "generate");
    if (rate.limited) {
        return NextResponse.json(
            { error: "Too many requests. Please slow down and try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
        );
    }

    let rawBody: unknown;
    try {
        rawBody = await readJsonBodyCapped(request, MAX_BODY_BYTES);
    } catch (error) {
        if (error instanceof PayloadTooLargeError) {
            return NextResponse.json({ error: "Request payload too large." }, { status: 413 });
        }
        return NextResponse.json(
            { error: "Invalid request payload." },
            { status: 400 }
        );
    }

    let body: GeneratorRequest;
    try {
        body = parseGeneratorRequestPayload(rawBody);
    } catch {
        return NextResponse.json(
            { error: "Invalid request payload." },
            { status: 400 }
        );
    }

    body = applyPublicVerificationPolicy(body);

    try {
        const isPreview = request.nextUrl.searchParams.get("preview") === "true";

        if (isPreview) {
            return NextResponse.json(createServerPreview(body));
        }

        const { archive } = createServerArchive(body);

        return new NextResponse(archive.slice(), {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${sanitizeRootFolder(body.serverConfig.name)}.zip"`,
            },
        });
    } catch (error) {
        // Do not leak raw internals (stack traces, multi-line errors).
        console.error("Generation error:", error);
        return NextResponse.json(
            { error: "Generation failed." },
            { status: 500 }
        );
    }
}
