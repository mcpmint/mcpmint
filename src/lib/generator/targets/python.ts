import type {
    GeneratedProject,
    GenerationPlan,
    GenerationRequestBody,
    GenerationTool,
    ToolAuthRequirementPlan,
} from "../types.ts";
import { collectAuthSchemes, getAuthSchemeKey } from "../strategies/auth.ts";
import { getPythonTransportRunLine, pythonNeedsHttpServer, LOCALHOST_ORIGIN_HOSTS } from "../strategies/transport.ts";
import { renderGeneratedReadme } from "../readme.ts";
import { FASTMCP_VERSION } from "../runtime-versions.ts";
import { renderDependabot, renderDependencyLock, renderLicenseSummary, renderProvenance, renderSbom, runtimePin } from "../supply-chain.ts";
import { toPythonStringLiteral } from "../utils.ts";
import { toPythonType } from "../schema.ts";
import {
    buildManifest,
    expectedSerializedParameterValue,
    getEnvExample,
    getExpectedJsonBody,
    getExpectedPath,
    getExpectedQueryEntries,
    getTestArgs,
    renderDockerCompose,
    scalarToExpectedString,
} from "./shared.ts";

function renderPythonSerializationOptions(param: GenerationTool["params"][number]): string {
    const style = param.style === undefined ? "None" : JSON.stringify(param.style);
    const explode = param.explode === undefined ? "None" : param.explode ? "True" : "False";
    return `{ "location": ${JSON.stringify(param.location)}, "style": ${style}, "explode": ${explode} }`;
}

function getPythonBodyExpression(requestBody: GenerationRequestBody): string {
    if (
        requestBody.contentKind === "rawJsonObject" ||
        requestBody.contentKind === "rawArray" ||
        requestBody.contentKind === "text" ||
        requestBody.contentKind === "binary"
    ) {
        return requestBody.params[0]?.argName || "body";
    }

    const properties = requestBody.params
        .map((param) => `            ${JSON.stringify(param.sourceName)}: ${param.argName},`)
        .join("\n");

    return `{\n${properties}\n        }`;
}

function isMultipartBinaryParam(param: GenerationRequestBody["params"][number]): boolean {
    return param.schema?.format === "binary" || param.schema?.type === "file";
}

function renderPythonMultipartAppend(param: GenerationRequestBody["params"][number]): string {
    const sourceName = JSON.stringify(param.sourceName);

    if (!isMultipartBinaryParam(param)) {
        return `    if ${param.argName} is not None:\n        multipart_files[${sourceName}] = (None, str(${param.argName}))`;
    }

    return `    if ${param.argName} is not None:\n        multipart_files[${sourceName}] = (${sourceName}, base64.b64decode(${param.argName}), "application/octet-stream")`;
}

function renderPythonRequestBody(requestBody?: GenerationRequestBody): {
    setup: string;
    headerLines: string[];
    requestArgs: string[];
} {
    if (!requestBody) {
        return { setup: "", headerLines: [], requestArgs: [] };
    }

    switch (requestBody.contentKind) {
        case "flattenedObject": {
            const setupLines = [
                "    json_body: dict[str, object] = {}",
                ...requestBody.params.map((param) => `    if ${param.argName} is not None:\n        json_body[${JSON.stringify(param.sourceName)}] = ${param.argName}`),
            ];

            return {
                setup: setupLines.join("\n"),
                headerLines: [`    request_headers["Content-Type"] = ${JSON.stringify(requestBody.contentType)}`],
                requestArgs: ["json=json_body"],
            };
        }
        case "rawJsonObject":
        case "rawArray":
            return {
                setup: "",
                headerLines: [`    request_headers["Content-Type"] = ${JSON.stringify(requestBody.contentType)}`],
                requestArgs: [`json=${getPythonBodyExpression(requestBody)}`],
            };
        case "text":
            return {
                setup: "",
                headerLines: [`    request_headers["Content-Type"] = ${JSON.stringify(requestBody.contentType)}`],
                requestArgs: [`content=str(${getPythonBodyExpression(requestBody)} or "")`],
            };
        case "formUrlencoded": {
            const setupLines = [
                "    form_body: dict[str, object] = {}",
                ...requestBody.params.map((param) => `    if ${param.argName} is not None:\n        form_body[${JSON.stringify(param.sourceName)}] = ${param.argName}`),
            ];

            return {
                setup: setupLines.join("\n"),
                headerLines: [`    request_headers["Content-Type"] = ${JSON.stringify(requestBody.contentType)}`],
                requestArgs: ["data=form_body"],
            };
        }
        case "multipart": {
            const setupLines = [
                "    multipart_files: dict[str, object] = {}",
                ...requestBody.params.map(renderPythonMultipartAppend),
            ];

            return {
                setup: setupLines.join("\n"),
                headerLines: [],
                requestArgs: ["files=multipart_files"],
            };
        }
        case "binary":
            return {
                setup: "",
                headerLines: [`    request_headers["Content-Type"] = ${JSON.stringify(requestBody.contentType)}`],
                requestArgs: [`content=base64.b64decode(str(${getPythonBodyExpression(requestBody)}), validate=True)`],
            };
    }
}

function renderPythonAuthRequirements(requirements?: ToolAuthRequirementPlan[]): string {
    if (!requirements?.length) return "[]";

    const renderedRequirements = requirements.map((requirement) => {
        const schemes = requirement.schemes
            .map((scheme) => `AUTH_SCHEMES[${JSON.stringify(getAuthSchemeKey(scheme))}]`)
            .join(", ");
        return `{"schemes": [${schemes}]}`;
    });

    return `[\n        ${renderedRequirements.join(",\n        ")}\n    ]`;
}

function getPythonSignatureParams(tool: GenerationTool): GenerationTool["params"] {
    return [...tool.params].sort((left, right) => Number(right.required) - Number(left.required));
}

function pythonParamType(param: GenerationTool["params"][number]): string {
    const types = Array.isArray(param.schema?.type) ? param.schema.type : [param.type];
    const result = types.map((type) => type === "null" ? "None" : toPythonType(String(type)));
    if ((param.schema?.nullable || !param.required) && !result.includes("None")) result.push("None");
    return [...new Set(result)].join(" | ");
}

function pythonInputSchema(tool: GenerationTool): Record<string, unknown> {
    return {
        type: "object",
        properties: Object.fromEntries(tool.params.map((p) => [p.argName, { ...(p.schema || { type: p.type }), description: p.description }])),
        required: tool.params.filter((p) => p.required).map((p) => p.argName),
        additionalProperties: false,
    };
}

function renderPythonOperation(tool: GenerationTool): string {
    const pathParams = tool.params.filter((param) => param.location === "path");
    const queryParams = tool.params.filter((param) => param.location === "query");
    const headerParams = tool.params.filter((param) => param.location === "header");
    const cookieParams = tool.params.filter((param) => param.location === "cookie");
    const bodyRender = renderPythonRequestBody(tool.requestBody);

    const signature = getPythonSignatureParams(tool)
        .map((param) => `${param.argName}: ${pythonParamType(param)}${param.required ? "" : " = None"}`)
        .join(", ");

    const pathReplacements = pathParams
        .map((param) => `    path = path.replace(${JSON.stringify(`{${param.sourceName}}`)}, serialize_path_parameter(${JSON.stringify(param.sourceName)}, ${param.argName}, ${renderPythonSerializationOptions(param)}))`)
        .join("\n");

    const queryLines = queryParams
        .map((param) => `    append_serialized_parameter(params, ${JSON.stringify(param.sourceName)}, ${param.argName}, ${renderPythonSerializationOptions(param)})`)
        .join("\n");

    const headerLines = headerParams
        .map((param) => `    if ${param.argName} is not None:\n        request_headers[${JSON.stringify(param.sourceName)}] = serialize_parameter_value(${JSON.stringify(param.sourceName)}, ${param.argName}, ${renderPythonSerializationOptions(param)})`)
        .join("\n");

    const cookieLines = cookieParams
        .map((param) => `    if ${param.argName} is not None:\n        cookies[${JSON.stringify(param.sourceName)}] = serialize_parameter_value(${JSON.stringify(param.sourceName)}, ${param.argName}, ${renderPythonSerializationOptions(param)})`)
        .join("\n");

    const requestArgs = [
        `method=${JSON.stringify(tool.method)}`,
        "path=path",
        `base_url=${JSON.stringify(tool.baseUrl || "")}`,
        "headers=request_headers",
        "params=params",
        "cookies=cookies",
        ...bodyRender.requestArgs,
    ];

    return `def ${tool.functionName}_operation(${signature}) -> dict:
    validate_arguments(${toPythonJsonLiteral(pythonInputSchema(tool))}, {${tool.params.map((p) => `${JSON.stringify(p.argName)}: ${p.argName}`).join(", ")}})
    path = ${JSON.stringify(tool.path)}
${pathReplacements ? `${pathReplacements}\n` : ""}    params: list[tuple[str, str]] = []
${queryLines ? `${queryLines}\n` : ""}    request_headers: dict[str, str] = {}
${headerLines ? `${headerLines}\n` : ""}    cookies: dict[str, str] = {}
${cookieLines ? `${cookieLines}\n` : ""}${bodyRender.setup ? `${bodyRender.setup}\n` : ""}${bodyRender.headerLines.length > 0 ? `${bodyRender.headerLines.join("\n")}\n` : ""}    apply_auth(
        params=params,
        headers=request_headers,
        cookies=cookies,
        auth_requirements=${renderPythonAuthRequirements(tool.authStrategy.requirements)},
    )
    response = request_api(
        ${requestArgs.join(",\n        ")},
    )
    return response_to_tool_result(response)
`;
}

function isObjectSchemaWithProperties(schema?: Record<string, unknown>): boolean {
    return Boolean(
        schema &&
        schema.type === "object" &&
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties) &&
        Object.keys(schema.properties as Record<string, unknown>).length > 0
    );
}

// Render an arbitrary JSON value as a Python literal (dict / list / str / bool / None).
// Used to embed a JSON Schema object as the `output_schema=` argument.
function toPythonJsonLiteral(value: unknown): string {
    if (value === null || value === undefined) return "None";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "True" : "False";
    if (Array.isArray(value)) return `[${value.map(toPythonJsonLiteral).join(", ")}]`;
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, entryValue]) => `${JSON.stringify(key)}: ${toPythonJsonLiteral(entryValue)}`);
        return `{${entries.join(", ")}}`;
    }
    return JSON.stringify(String(value));
}

// Build the MCP output schema (a JSON Schema object) emitted as FastMCP's
// `output_schema=`. MCP output schemas must be object shapes: object schemas with
// named properties pass through unchanged; any other shape (array, primitive,
// unconstrained object) is wrapped under a single `result` property to match the
// wrapped structured content the handler returns. Returns undefined when there is
// no usable output schema.
function buildPythonOutputSchema(outputSchema?: Record<string, unknown>): { literal: string; wrapsResult: boolean } | undefined {
    if (!outputSchema || Object.keys(outputSchema).length === 0) return undefined;

    if (isObjectSchemaWithProperties(outputSchema)) {
        return { literal: toPythonJsonLiteral(outputSchema), wrapsResult: false };
    }

    return {
        literal: toPythonJsonLiteral({
            type: "object",
            properties: { result: outputSchema },
            required: ["result"],
        }),
        wrapsResult: true,
    };
}

// Render FastMCP `ToolAnnotations(...)` keyword arguments (MCP 2025-11-25). Behavioral
// hints derived from HTTP method semantics; advisory only. Returns undefined when no
// annotations are present.
function renderPythonAnnotations(annotations?: GenerationTool["annotations"]): string | undefined {
    if (!annotations) return undefined;

    const entries: string[] = [];
    if (annotations.title) entries.push(`title=${toPythonStringLiteral(annotations.title)}`);
    if (annotations.readOnlyHint !== undefined) entries.push(`readOnlyHint=${annotations.readOnlyHint ? "True" : "False"}`);
    if (annotations.destructiveHint !== undefined) entries.push(`destructiveHint=${annotations.destructiveHint ? "True" : "False"}`);
    if (annotations.idempotentHint !== undefined) entries.push(`idempotentHint=${annotations.idempotentHint ? "True" : "False"}`);
    if (annotations.openWorldHint !== undefined) entries.push(`openWorldHint=${annotations.openWorldHint ? "True" : "False"}`);

    if (entries.length === 0) return undefined;
    return `ToolAnnotations(${entries.join(", ")})`;
}

function renderPythonServerTool(tool: GenerationTool): string {
    const signature = getPythonSignatureParams(tool)
        .map((param) => `${param.argName}: ${pythonParamType(param)}${param.required ? "" : " = None"}`)
        .join(", ");
    const args = getPythonSignatureParams(tool).map((param) => param.argName).join(", ");

    const output = buildPythonOutputSchema(tool.outputSchema);
    const annotations = renderPythonAnnotations(tool.annotations);

    const decoratorArgs = [`name=${toPythonStringLiteral(tool.displayName)}`];
    if (annotations) decoratorArgs.push(`annotations=${annotations}`);
    if (output) decoratorArgs.push(`output_schema=${output.literal}`);

    // With an output_schema, FastMCP builds structured content from the returned dict.
    // Wrap non-object payloads under `result` to match the wrapped output shape.
    const returnExpression = output && output.wrapsResult
        ? `{"result": ${tool.functionName}_operation(${args})}`
        : `${tool.functionName}_operation(${args})`;

    return `def ${tool.functionName}(${signature}) -> dict:
    ${toPythonStringLiteral(tool.description)}
    return ${returnExpression}

${tool.functionName}_tool = FunctionTool.from_function(${tool.functionName}, ${decoratorArgs.join(", ")})
${tool.functionName}_tool.parameters = normalized_schema(${toPythonJsonLiteral(pythonInputSchema(tool))})
mcp.add_tool(${tool.functionName}_tool)
`;
}

// ---------------------------------------------------------------------------
// COMPACT MODE (meta-tools) — Python / FastMCP target
//
// When `plan.runtime.compactMode` is true the server registers exactly three
// meta-tools (list/get/invoke) instead of one @mcp.tool per operation. All three
// read from a single immutable in-memory registry (`META_OPERATIONS`) built from
// `plan.tools`, keyed by tool id. `invoke_api_endpoint` dispatches through the
// SAME per-operation request functions (`<fn>_operation`) used in non-compact
// mode, so request building / auth is never reinvented. Mirrors the Node target's
// `renderCompactServer`. See the DESIGN CONTRACT on
// GenerationPlan.runtime.compactMode in types.ts.
// ---------------------------------------------------------------------------

// Lightweight, secret-free auth descriptor for get_api_endpoint_schema output.
// Mirrors the Node target's renderCompactAuthDescriptor (never emits secrets).
function renderPythonCompactAuthDescriptor(tool: GenerationTool): string {
    const requirements = tool.authStrategy.requirements;
    if (!requirements?.length) return "[]";
    const schemes = new Map<string, string>();
    for (const requirement of requirements) {
        for (const scheme of requirement.schemes) {
            const entry: Record<string, unknown> = { type: scheme.strategy, name: scheme.schemeName };
            if (scheme.apiKeyName) entry.apiKeyName = scheme.apiKeyName;
            if (scheme.apiKeyLocation) entry.in = scheme.apiKeyLocation;
            schemes.set(`${scheme.strategy}:${scheme.schemeName}`, toPythonJsonLiteral(entry));
        }
    }
    return `[${[...schemes.values()].join(", ")}]`;
}

// One immutable registry entry. `parameters` describes how the model-supplied
// { path, query, header, body } object maps back onto the flat args the stored
// operation function expects; `invoke` is the stored per-operation request
// function reference (dispatch never rebuilds a URL). Mirrors the Node target's
// renderCompactRegistryEntry.
function renderPythonCompactRegistryEntry(tool: GenerationTool): string {
    const parameterDescriptors = tool.params
        .map((param) => `            {"name": ${JSON.stringify(param.argName)}, "in": ${JSON.stringify(param.location)}, "required": ${param.required ? "True" : "False"}, "schema": ${toPythonJsonLiteral(param.schema ?? {})}}`)
        .join(",\n");

    const bodyParamNames = tool.requestBody?.params.map((param) => param.argName) ?? [];

    const entries: string[] = [
        `        "id": ${JSON.stringify(tool.id)}`,
        `        "method": ${JSON.stringify(tool.method)}`,
        `        "path": ${JSON.stringify(tool.path)}`,
        `        "summary": ${toPythonStringLiteral((tool.title || tool.description || "").slice(0, 120))}`,
        `        "description": ${toPythonStringLiteral(tool.description)}`,
        `        "tags": []`,
        `        "parameters": [\n${parameterDescriptors ? `${parameterDescriptors}\n        ` : ""}]`,
        `        "body_content_kind": ${tool.requestBody ? JSON.stringify(tool.requestBody.contentKind) : "None"}`,
        `        "body_param_names": ${toPythonJsonLiteral(bodyParamNames)}`,
        `        "request_body": ${tool.requestBody?.schema ? toPythonJsonLiteral(tool.requestBody.schema) : "None"}`,
        `        "output_schema": ${tool.outputSchema && Object.keys(tool.outputSchema).length > 0 ? toPythonJsonLiteral(tool.outputSchema) : "None"}`,
        `        "auth": ${renderPythonCompactAuthDescriptor(tool)}`,
        `        "invoke": ${tool.functionName}_operation`,
    ];

    return `    {\n${entries.join(",\n")}\n    }`;
}

function renderCompactServer(plan: GenerationPlan): string {
    const runLine = getPythonTransportRunLine(plan);
    const operationImports = plan.tools
        .map((tool) => `    ${tool.functionName}_operation,`)
        .join("\n");
    const registryEntries = plan.tools.map(renderPythonCompactRegistryEntry).join(",\n");

    // The registry is the single source of truth. The id space is CLOSED:
    // invoke can only ever reach a real, generated operation. Tuple + MappingProxyType
    // make the registry effectively immutable at runtime (no eval, stored templates only).
    return `"""${plan.server.name} - MCP server generated by mcpmint ${plan.generatorVersion}"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import sys
from types import MappingProxyType

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from config import MCP_SERVER_CONFIG
from operations import (
${operationImports}
)


# On the stdio transport, stdout carries the JSON-RPC stream, so operator diagnostics
# must never be written to stdout (a stray print corrupts the protocol). Route the
# standard logging module to stderr; the generated server emits no bare print() calls.
logging.basicConfig(level=logging.INFO, stream=sys.stderr)

mcp = FastMCP(MCP_SERVER_CONFIG["name"])

# Maximum characters of upstream response returned in a single invoke envelope.
# Bounds the context cost of one call regardless of API payload size.
MAX_INVOKE_RESULT_CHARS = 100_000

# HTTP methods accepted by list_api_endpoints' method filter.
HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")

# Immutable operation registry — the single source of truth for all three
# meta-tools. Each entry's "invoke" is the stored per-operation request function,
# so dispatch never rebuilds a URL or evals a model-supplied string.
META_OPERATIONS = (
${registryEntries},
)

# id -> operation lookup. The id space is CLOSED: invoke can only ever reach a
# real, generated operation.
META_OPERATIONS_BY_ID = MappingProxyType({operation["id"]: operation for operation in META_OPERATIONS})


def _encode_cursor(offset: int) -> str:
    return base64.b64encode(str(offset).encode("utf-8")).decode("utf-8")


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        parsed = int(base64.b64decode(cursor.encode("utf-8")).decode("utf-8"))
    except (ValueError, binascii.Error):
        return 0
    return parsed if parsed >= 0 else 0


def _as_object(value: object) -> dict:
    return value if isinstance(value, dict) else {}


# Validate the supplied arguments against the stored parameter descriptors BEFORE
# any network I/O. Rejects unknown params, missing-required params, and gross
# type mismatches. Mirrors the intent of the Node target's compiled Zod validator.
def _validate_operation_args(operation: dict, args: dict) -> list[dict]:
    issues: list[dict] = []
    descriptors = [param for param in operation["parameters"] if param["in"] != "body"]
    allowed = {param["name"] for param in descriptors}
    allowed.update(operation["body_param_names"])

    for name in args:
        if name not in allowed:
            issues.append({"field": name, "message": "Unknown parameter."})

    for param in descriptors:
        name = param["name"]
        if param["required"] and args.get(name) is None:
            issues.append({"field": name, "message": "Missing required parameter."})
            continue
        if name in args and args[name] is not None and not _value_matches_schema_type(args[name], param["schema"]):
            issues.append({"field": name, "message": "Type mismatch for parameter."})

    return issues


def _value_matches_schema_type(value: object, schema: dict) -> bool:
    expected = schema.get("type") if isinstance(schema, dict) else None
    if not expected:
        return True
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    return True


# Flatten the model-supplied {path, query, header, body} object onto the flat,
# argName-keyed args dict the stored operation function expects. Values are read
# strictly by the registry's parameter descriptors — never from arbitrary keys —
# so the model cannot smuggle in unknown parameters. Mirrors Node's toOperationArgs.
def _to_operation_args(operation: dict, parameters: dict | None) -> dict:
    parameters = parameters or {}
    args: dict = {}
    buckets = {
        "path": _as_object(parameters.get("path")),
        "query": _as_object(parameters.get("query")),
        "header": _as_object(parameters.get("header")),
        "cookie": _as_object(parameters.get("cookie")),
    }

    for param in operation["parameters"]:
        location = param["in"]
        if location == "body":
            continue
        bucket = buckets.get(location)
        if bucket is not None and param["name"] in bucket:
            args[param["name"]] = bucket[param["name"]]

    # Request body. A single raw body param takes the whole body; a flattened
    # object body maps each named field out of the body object by argName.
    body = parameters.get("body")
    kind = operation["body_content_kind"]
    body_param_names = operation["body_param_names"]
    if kind in ("rawJsonObject", "rawArray", "text", "binary"):
        if body_param_names:
            args[body_param_names[0]] = body
    elif body_param_names:
        body_object = _as_object(body)
        for name in body_param_names:
            if name in body_object:
                args[name] = body_object[name]

    return args


def _bounded_result(text: str) -> tuple[object, bool]:
    truncated = len(text) > MAX_INVOKE_RESULT_CHARS
    bounded = text[:MAX_INVOKE_RESULT_CHARS] if truncated else text
    try:
        return json.loads(bounded), truncated
    except (ValueError, TypeError):
        return bounded, truncated


@mcp.tool(
    name="list_api_endpoints",
    annotations=ToolAnnotations(
        title="List API Endpoints",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
)
def list_api_endpoints(
    search: str | None = None,
    tag: str | None = None,
    method: str | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> dict:
    "Search and list available API operations. Returns lightweight records (id, method, path, summary, tags) - NOT full parameter schemas. Call get_api_endpoint_schema before invoking."
    search_term = search.strip().lower() if search else None
    tag_term = tag.strip().lower() if tag else None
    method_term = method.upper() if method else None
    page_limit = max(1, min(100, limit)) if limit is not None else 50
    offset = _decode_cursor(cursor)

    matches = []
    for operation in META_OPERATIONS:
        if method_term and operation["method"] != method_term:
            continue
        if tag_term and not any(entry.lower() == tag_term for entry in operation["tags"]):
            continue
        if search_term:
            haystack = " ".join([
                operation["id"],
                operation["method"],
                operation["path"],
                operation["summary"],
                operation["description"],
                " ".join(operation["tags"]),
            ]).lower()
            if search_term not in haystack:
                continue
        matches.append(operation)

    page = matches[offset:offset + page_limit]
    next_offset = offset + len(page)
    result: dict = {
        "endpoints": [
            {
                "id": operation["id"],
                "method": operation["method"],
                "path": operation["path"],
                "summary": operation["summary"],
                "tags": operation["tags"],
            }
            for operation in page
        ],
        "total_estimate": len(matches),
    }
    if next_offset < len(matches):
        result["next_cursor"] = _encode_cursor(next_offset)
    return result


@mcp.tool(
    name="get_api_endpoint_schema",
    annotations=ToolAnnotations(
        title="Get API Endpoint Schema",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
)
def get_api_endpoint_schema(endpointId: str) -> dict:
    "Get the full input (parameters + request body) and output schema, plus description, for one operation by id. Call after list_api_endpoints and before invoke_api_endpoint."
    operation = META_OPERATIONS_BY_ID.get(endpointId)
    if operation is None:
        return {"error": {"type": "unknown_operation", "message": f"Unknown endpoint id: {endpointId}"}}

    return {
        "id": operation["id"],
        "method": operation["method"],
        "path": operation["path"],
        "summary": operation["summary"],
        "description": operation["description"],
        "parameters": [
            {
                "name": param["name"],
                "in": param["in"],
                "required": param["required"],
                "schema": param["schema"],
            }
            for param in operation["parameters"]
            if param["in"] != "body"
        ],
        "requestBody": operation["request_body"],
        "outputSchema": operation["output_schema"],
        "auth": operation["auth"],
    }


@mcp.tool(
    name="invoke_api_endpoint",
    annotations=ToolAnnotations(
        title="Invoke API Endpoint",
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=False,
        openWorldHint=True,
    ),
)
def invoke_api_endpoint(endpointId: str, parameters: dict | None = None) -> dict:
    "Invoke one operation by id. Arguments are validated against that operation's schema before any request is made."
    # (a) Closed registry - refuse unknown ids and make NO HTTP call.
    operation = META_OPERATIONS_BY_ID.get(endpointId)
    if operation is None:
        return {
            "ok": False,
            "endpointId": endpointId,
            "error": {"type": "unknown_operation", "message": f"Unknown endpoint id: {endpointId}"},
        }

    # Map the {path, query, header, body} object onto flat operation args by the
    # registry's parameter descriptors (never arbitrary model keys).
    operation_args = _to_operation_args(operation, parameters)

    # (b) Validate BEFORE any network I/O against the stored operation schema.
    issues = _validate_operation_args(operation, operation_args)
    if issues:
        return {
            "ok": False,
            "endpointId": operation["id"],
            "error": {"type": "validation_error", "message": "Arguments failed schema validation.", "details": issues},
        }

    # (c) Dispatch through the stored per-operation request function, which builds
    # the request from the operation's method + path template and (d) applies auth
    # server-side from config/env. The model never supplies a URL or secret.
    try:
        response = operation["invoke"](**operation_args)
        text = json.dumps(response) if not isinstance(response, str) else response
        data, truncated = _bounded_result(text)
        envelope: dict = {"ok": True, "status": 200, "endpointId": operation["id"], "data": data}
        if truncated:
            envelope["truncated"] = True
        return envelope
    except Exception as error:  # noqa: BLE001 - surface upstream failures in the envelope
        return {
            "ok": False,
            "endpointId": operation["id"],
            "error": {"type": "http_error", "message": str(error)},
        }


if __name__ == "__main__":
${runLine}
`;
}

function renderServer(plan: GenerationPlan): string {
    if (plan.runtime.compactMode) {
        return renderCompactServer(plan);
    }

    const runLine = getPythonTransportRunLine(plan);
    const operationImports = plan.tools
        .map((tool) => `    ${tool.functionName}_operation,`)
        .join("\n");

    return `"""${plan.server.name} - MCP server generated by mcpmint ${plan.generatorVersion}"""

from __future__ import annotations

import logging
import sys

from fastmcp import FastMCP
from fastmcp.tools import FunctionTool
from validation import normalized_schema
from mcp.types import ToolAnnotations
from config import MCP_SERVER_CONFIG
from operations import (
${operationImports}
)


# On the stdio transport, stdout carries the JSON-RPC stream, so operator diagnostics
# must never be written to stdout (a stray print corrupts the protocol). Route the
# standard logging module to stderr; the generated server emits no bare print() calls.
logging.basicConfig(level=logging.INFO, stream=sys.stderr)

mcp = FastMCP(MCP_SERVER_CONFIG["name"])


${plan.tools.map(renderPythonServerTool).join("\n")}
if __name__ == "__main__":
${runLine}
`;
}

function renderAccess(plan: GenerationPlan): string {
    const localhostHosts = JSON.stringify([...LOCALHOST_ORIGIN_HOSTS]);

    return `"""MCP server access enforcement for HTTP/SSE transports.

Mirrors the Node target: constant-time bearer comparison plus deny-by-default
Origin validation (only localhost origins are accepted when no allow-list is
configured, mitigating DNS-rebinding against locally-bound servers).
"""

from __future__ import annotations

import hmac
import json
from urllib.parse import urlparse

from starlette.middleware import Middleware
from starlette.types import ASGIApp, Receive, Scope, Send

from config import MCP_SERVER_ACCESS_CONFIG

# Hosts treated as local when no explicit allow-list is configured (deny-by-default).
LOCALHOST_HOSTS = set(${localhostHosts})


def assert_mcp_server_access_config() -> None:
    if MCP_SERVER_ACCESS_CONFIG["auth_type"] == "bearer" and not MCP_SERVER_ACCESS_CONFIG["auth_token"]:
        raise RuntimeError(
            "${plan.mcpServerAuth.tokenEnvVar} is required when MCP server bearer auth is enabled."
        )


def _is_localhost_origin(origin: str) -> bool:
    try:
        return urlparse(origin).hostname in LOCALHOST_HOSTS
    except ValueError:
        return False


def is_origin_allowed(origin: str | None, allowed_origins: list[str]) -> bool:
    # Requests without an Origin header (e.g. non-browser clients) are permitted.
    if not origin:
        return True
    # Deny-by-default: with no configured allow-list, only localhost origins are accepted.
    if not allowed_origins:
        return _is_localhost_origin(origin)
    return origin in allowed_origins


def is_bearer_authorized(authorization: str | None, token: str) -> bool:
    if not token or not authorization:
        return False
    # Constant-time comparison to avoid leaking the token via timing side channels.
    return hmac.compare_digest(authorization, f"Bearer {token}")


def _header(scope: Scope, name: str) -> str | None:
    target = name.lower().encode("latin-1")
    for raw_name, raw_value in scope.get("headers", []):
        if raw_name == target:
            return raw_value.decode("latin-1")
    return None


class McpAccessMiddleware:
    """ASGI middleware enforcing Origin policy and bearer auth for the MCP endpoint."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origin = _header(scope, "origin")
        allowed_origins = MCP_SERVER_ACCESS_CONFIG["allowed_origins"]

        if not is_origin_allowed(origin, allowed_origins):
            await self._reject(send, 403, "Origin not allowed")
            return

        if MCP_SERVER_ACCESS_CONFIG["auth_type"] == "bearer":
            token = MCP_SERVER_ACCESS_CONFIG["auth_token"]
            if not token:
                await self._reject(send, 500, "${plan.mcpServerAuth.tokenEnvVar} is required")
                return

            authorization = _header(scope, "authorization")
            if not is_bearer_authorized(authorization, token):
                await self._reject(
                    send,
                    401,
                    "Missing or invalid bearer token",
                    extra_headers=[(b"www-authenticate", b"Bearer")],
                )
                return

        await self.app(scope, receive, send)

    async def _reject(
        self,
        send: Send,
        status_code: int,
        message: str,
        extra_headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        body = json.dumps({"error": message}).encode("utf-8")
        headers = [(b"content-type", b"application/json")]
        if extra_headers:
            headers.extend(extra_headers)
        await send({"type": "http.response.start", "status": status_code, "headers": headers})
        await send({"type": "http.response.body", "body": body})


def build_mcp_access_middleware() -> list[Middleware]:
    return [Middleware(McpAccessMiddleware)]
`;
}

function renderConfig(plan: GenerationPlan): string {
    const authSchemes = collectAuthSchemes(plan);
    const authSchemeEntries = authSchemes.map((auth) => {
        const scheme = auth.scheme;

        if (scheme.strategy === "apiKeyHeader" || scheme.strategy === "apiKeyQuery" || scheme.strategy === "apiKeyCookie") {
            return `    ${JSON.stringify(auth.key)}: {"type": "apiKey", "in": ${JSON.stringify(scheme.apiKeyLocation || "header")}, "name": ${JSON.stringify(scheme.apiKeyName || "X-API-Key")}, "value": os.getenv(${JSON.stringify(auth.apiKeyEnvVar)}, "")},`;
        }

        if (scheme.strategy === "bearer") {
            return `    ${JSON.stringify(auth.key)}: {"type": "bearer", "token": os.getenv(${JSON.stringify(auth.bearerTokenEnvVar)}, "")},`;
        }

        return `    ${JSON.stringify(auth.key)}: {"type": "basic", "username": os.getenv(${JSON.stringify(auth.basicUsernameEnvVar)}, ""), "password": os.getenv(${JSON.stringify(auth.basicPasswordEnvVar)}, "")},`;
    }).join("\n");

    return `from __future__ import annotations

import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

def parse_mcp_allowed_origins(value: str | None, fallback: list[str]) -> list[str]:
    if value is None or not value.strip():
        return list(fallback)
    return [origin.strip() for origin in value.split(",") if origin.strip()]


API_BASE_URL = os.getenv("API_BASE_URL", "")
AUTH_SCHEMES = {
${authSchemeEntries}
}

MCP_SERVER_CONFIG = {
    "name": ${JSON.stringify(plan.server.name)},
    "version": ${JSON.stringify(plan.server.version)},
    "host": os.getenv("MCP_HOST", ${JSON.stringify(plan.server.host)}),
    "port": int(os.getenv("PORT", ${JSON.stringify(String(plan.server.port))})),
}

MCP_SERVER_ACCESS_CONFIG = {
    "auth_type": ${JSON.stringify(plan.mcpServerAuth.type)},
    "auth_token": os.getenv(${JSON.stringify(plan.mcpServerAuth.tokenEnvVar)}, "") if ${JSON.stringify(plan.mcpServerAuth.type)} == "bearer" else "",
    "allowed_origins": parse_mcp_allowed_origins(os.getenv(${JSON.stringify(plan.mcpServerAuth.allowedOriginsEnvVar)}), ${JSON.stringify(plan.mcpServerAuth.allowedOrigins)}),
}
`;
}

function renderApiClient(): string {
    return `from __future__ import annotations

import base64
import httpx
from fastmcp.exceptions import ToolError
from config import API_BASE_URL

client = httpx.Client(timeout=30.0)


AuthScheme = dict[str, object]
AuthRequirement = dict[str, list[AuthScheme]]


def is_auth_scheme_configured(scheme: AuthScheme) -> bool:
    if scheme["type"] == "apiKey":
        return bool(scheme.get("value"))
    if scheme["type"] == "bearer":
        return bool(scheme.get("token"))
    return bool(scheme.get("username") or scheme.get("password"))


def is_auth_requirement_configured(requirement: AuthRequirement) -> bool:
    schemes = requirement.get("schemes", [])
    return all(is_auth_scheme_configured(scheme) for scheme in schemes)


def has_header(headers: dict[str, str], name: str) -> bool:
    normalized_name = name.lower()
    return any(header_name.lower() == normalized_name for header_name in headers)


def apply_auth(
    *,
    params: list[tuple[str, str]],
    headers: dict[str, str],
    cookies: dict[str, str],
    auth_requirements: list[AuthRequirement],
) -> None:
    requirement = next((entry for entry in auth_requirements if is_auth_requirement_configured(entry)), None)
    if requirement is None:
        return

    for scheme in requirement.get("schemes", []):
        if not is_auth_scheme_configured(scheme):
            continue

        if scheme["type"] == "apiKey":
            name = str(scheme["name"])
            if scheme["in"] == "query" and not any(param_name == name for param_name, _ in params):
                params.append((name, str(scheme["value"])))
            elif scheme["in"] == "cookie" and name not in cookies:
                cookies[name] = str(scheme["value"])
            elif scheme["in"] == "header" and not has_header(headers, name):
                headers[name] = str(scheme["value"])
        elif scheme["type"] == "bearer" and not has_header(headers, "Authorization"):
            headers["Authorization"] = f"Bearer {scheme['token']}"
        elif scheme["type"] == "basic" and not has_header(headers, "Authorization"):
            username = str(scheme.get("username", ""))
            password = str(scheme.get("password", ""))
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"


def request_api(
    *,
    method: str,
    path: str,
    base_url: str = "",
    headers: dict[str, str],
    params: list[tuple[str, str]],
    cookies: dict[str, str],
    **kwargs: object,
) -> httpx.Response:
    request_kwargs = {key: value for key, value in kwargs.items() if value is not None}
    url = f"{(API_BASE_URL or base_url or 'https://api.example.com').rstrip('/')}{path}"
    with client.stream(method=method, url=url, headers=headers, params=params, cookies=cookies,
                       follow_redirects=False, **request_kwargs) as response:
        if 300 <= response.status_code < 400:
            raise ToolError("Upstream redirect rejected. Configure the final API base URL explicitly.")
        if response.status_code >= 400:
            raise ToolError(f"Upstream returned HTTP {response.status_code}.")
        chunks = []
        size = 0
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > 1_048_576:
                raise ToolError("Upstream response exceeded the 1 MiB limit.")
            chunks.append(chunk)
        return httpx.Response(response.status_code, headers=response.headers, content=b"".join(chunks))


def response_to_tool_result(response: httpx.Response) -> dict:
    # Surface upstream HTTP failures as ToolError so the client receives an isError
    # tool result the model can self-correct on, rather than a raw traceback that
    # would fail the tool call opaquely.
    if response.status_code >= 400:
        raise ToolError(f"Upstream returned HTTP {response.status_code}.")
    if "application/json" in response.headers.get("content-type", ""):
        return response.json()
    return {"text": response.text}
`;
}

function renderSerialization(): string {
    return `from __future__ import annotations

from urllib.parse import quote


def default_parameter_style(location: str) -> str:
    if location in ("path", "header"):
        return "simple"
    return "form"


def should_explode(style: str, explode: bool | None) -> bool:
    return explode if explode is not None else style == "form"


def scalar_to_string(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return str(value)


def object_entries(value: object) -> list[tuple[str, object]]:
    if not isinstance(value, dict):
        return []
    return [(str(key), entry_value) for key, entry_value in value.items() if entry_value is not None]


def serialize_parameter_value(name: str, value: object, options: dict) -> str:
    style = options.get("style") or default_parameter_style(options["location"])
    explode = should_explode(style, options.get("explode"))
    delimiter = " " if style == "spaceDelimited" else "|" if style == "pipeDelimited" else ","

    if isinstance(value, list):
        return delimiter.join(scalar_to_string(entry) for entry in value)

    entries = object_entries(value)
    if entries:
        if explode:
            return delimiter.join(f"{key}={scalar_to_string(entry_value)}" for key, entry_value in entries)
        flattened: list[str] = []
        for key, entry_value in entries:
            flattened.extend([key, scalar_to_string(entry_value)])
        return delimiter.join(flattened)

    return scalar_to_string(value)


def serialize_path_parameter(name: str, value: object, options: dict) -> str:
    style = options.get("style") or "simple"
    explode = should_explode(style, options.get("explode"))
    encoded_name = quote(name, safe="")

    def encode(entry: object) -> str:
        return quote(scalar_to_string(entry), safe="")

    if isinstance(value, list):
        encoded_values = [encode(entry) for entry in value]
        if style == "label":
            return "." + ".".join(encoded_values)
        if style == "matrix":
            if explode:
                return "".join(f";{encoded_name}={entry}" for entry in encoded_values)
            return f";{encoded_name}={','.join(encoded_values)}"
        return ",".join(encoded_values)

    entries = object_entries(value)
    if entries:
        if style == "label":
            if explode:
                values = [f"{quote(key, safe='')}={encode(entry_value)}" for key, entry_value in entries]
            else:
                values = [item for key, entry_value in entries for item in (quote(key, safe=""), encode(entry_value))]
            return "." + ".".join(values)
        if style == "matrix":
            if explode:
                return "".join(f";{quote(key, safe='')}={encode(entry_value)}" for key, entry_value in entries)
            values = [item for key, entry_value in entries for item in (quote(key, safe=""), encode(entry_value))]
            return f";{encoded_name}={','.join(values)}"
        if explode:
            values = [f"{quote(key, safe='')}={encode(entry_value)}" for key, entry_value in entries]
        else:
            values = [item for key, entry_value in entries for item in (quote(key, safe=""), encode(entry_value))]
        return ",".join(values)

    encoded_value = encode(value)
    if style == "label":
        return f".{encoded_value}"
    if style == "matrix":
        return f";{encoded_name}={encoded_value}"
    return encoded_value


def append_serialized_parameter(params: list[tuple[str, str]], name: str, value: object, options: dict) -> None:
    if value is None:
        return

    style = options.get("style") or "form"
    explode = should_explode(style, options.get("explode"))

    if isinstance(value, list):
        if style == "form" and explode:
            params.extend((name, scalar_to_string(entry)) for entry in value)
            return
        params.append((name, serialize_parameter_value(name, value, {**options, "style": style, "explode": explode})))
        return

    entries = object_entries(value)
    if entries:
        if style == "deepObject":
            params.extend((f"{name}[{key}]", scalar_to_string(entry_value)) for key, entry_value in entries)
            return
        if style == "form" and explode:
            params.extend((key, scalar_to_string(entry_value)) for key, entry_value in entries)
            return
        params.append((name, serialize_parameter_value(name, value, {**options, "style": style, "explode": explode})))
        return

    params.append((name, scalar_to_string(value)))
`;
}

function renderOperations(plan: GenerationPlan): string {
    const needsBase64 = plan.tools.some((tool) =>
        (tool.requestBody?.contentKind === "binary") || (tool.requestBody?.contentKind === "multipart" &&
        tool.requestBody.params.some(isMultipartBinaryParam))
    );

    return `from __future__ import annotations

${needsBase64 ? "import base64\n" : ""}from api_client import apply_auth, request_api, response_to_tool_result
from validation import validate_arguments
from config import AUTH_SCHEMES
from serialization import (
    append_serialized_parameter,
    serialize_parameter_value,
    serialize_path_parameter,
)


${plan.tools.map(renderPythonOperation).join("\n")}`;
}

function renderReadme(plan: GenerationPlan): string {
    return renderGeneratedReadme(plan, {
        installCommand: "pip install -e .",
        runCommand: "python src/server.py",
        stdioClientCommand: "python",
        stdioClientArgs: ["src/server.py"],
        runtimeDependencies: [
            { name: "fastmcp", version: FASTMCP_VERSION },
        ],
    });
}

function renderDockerfile(plan: GenerationPlan): string {
    // Two-stage build: install into a virtualenv in the build stage, then ship a lean
    // non-root runtime that only carries the venv and sources. Same run modes as Node:
    //   stdio: docker run -i --rm IMAGE
    //   HTTP: select HTTP when generating, then publish the configured port.
    return `# ---- Build stage ----
FROM python:3.11.13-slim-bookworm AS build
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY pyproject.toml ./
COPY src ./src
COPY mcpmint.manifest.json ./mcpmint.manifest.json
RUN pip install --no-cache-dir .

# ---- Runtime stage ----
FROM python:3.11.13-slim-bookworm AS runtime
WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 MCP_HOST=0.0.0.0 PORT=${plan.server.port}
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=build --chown=app:app /opt/venv /opt/venv
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE ${plan.server.port}
ENTRYPOINT ["python", "src/server.py"]
`;
}

// The registry `server.json` name is reverse-DNS + "/" + server id
// (^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$). Default the namespace to the GitHub-verified
// form (io.github.<owner>) since that is the simplest ownership path; owners edit
// the placeholder owner before publishing. Mirrors the Node target's server.json,
// with the PyPI package variant per the MCP registry schema.
const SERVER_JSON_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function sanitizeServerId(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return cleaned || "mcp-server";
}

function toRegistryTransportType(plan: GenerationPlan): "stdio" | "streamable-http" | "sse" {
    if (plan.runtime.transport === "http") return "streamable-http";
    if (plan.runtime.transport === "sse") return "sse";
    return "stdio";
}

function buildServerJsonEnvironmentVariables(plan: GenerationPlan): Array<Record<string, unknown>> {
    const variables: Array<Record<string, unknown>> = [
        { name: "API_BASE_URL", description: "Base URL for upstream API requests.", isRequired: false, isSecret: false },
    ];

    for (const auth of collectAuthSchemes(plan)) {
        if (auth.apiKeyEnvVar) variables.push({ name: auth.apiKeyEnvVar, description: "API key for the upstream API.", isRequired: false, isSecret: true });
        if (auth.bearerTokenEnvVar) variables.push({ name: auth.bearerTokenEnvVar, description: "Bearer token for the upstream API.", isRequired: false, isSecret: true });
        if (auth.basicUsernameEnvVar) variables.push({ name: auth.basicUsernameEnvVar, description: "Basic auth username for the upstream API.", isRequired: false, isSecret: false });
        if (auth.basicPasswordEnvVar) variables.push({ name: auth.basicPasswordEnvVar, description: "Basic auth password for the upstream API.", isRequired: false, isSecret: true });
    }

    if (plan.runtime.transport !== "stdio" && plan.mcpServerAuth.type === "bearer") {
        variables.push({ name: plan.mcpServerAuth.tokenEnvVar, description: "Bearer token protecting MCP server access over HTTP/SSE.", isRequired: true, isSecret: true });
    }

    return variables;
}

// Emit a registry-ready server.json (PyPI variant) per the MCP registry schema.
// `identifier`, `version`, and the top-level `version` are kept in sync with the
// package version; owners replace the placeholder namespace/repository before publishing.
function renderServerJson(plan: GenerationPlan): string {
    const serverId = sanitizeServerId(plan.server.name);
    const description = (plan.spec.description?.trim() || `MCP server generated from ${plan.spec.title}.`).slice(0, 100);

    return `${JSON.stringify({
        $schema: SERVER_JSON_SCHEMA_URL,
        name: `io.github.OWNER/${serverId}`,
        description,
        title: plan.spec.title,
        repository: { url: "https://github.com/OWNER/REPO", source: "github" },
        version: plan.server.version,
        packages: [
            {
                registryType: "pypi",
                registryBaseUrl: "https://pypi.org",
                identifier: plan.server.name,
                version: plan.server.version,
                runtimeHint: "uvx",
                transport: { type: toRegistryTransportType(plan) },
                environmentVariables: buildServerJsonEnvironmentVariables(plan),
            },
        ],
    }, null, 2)}\n`;
}

function toPythonLiteral(value: unknown): string {
    if (value === null || value === undefined) return "None";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "True" : "False";
    if (Array.isArray(value)) return `[${value.map(toPythonLiteral).join(", ")}]`;
    if (typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .map(([key, entryValue]) => `${JSON.stringify(key)}: ${toPythonLiteral(entryValue)}`)
            .join(", ")}}`;
    }
    return JSON.stringify(String(value));
}

function renderPythonAuthEnvAssignments(plan: GenerationPlan): string {
    const assignments: string[] = [`    monkeypatch.setenv("API_BASE_URL", "https://unit.example.test")`];

    for (const auth of collectAuthSchemes(plan)) {
        if (auth.apiKeyEnvVar) assignments.push(`    monkeypatch.setenv(${JSON.stringify(auth.apiKeyEnvVar)}, "test-api-key")`);
        if (auth.bearerTokenEnvVar) assignments.push(`    monkeypatch.setenv(${JSON.stringify(auth.bearerTokenEnvVar)}, "test-bearer-token")`);
        if (auth.basicUsernameEnvVar) assignments.push(`    monkeypatch.setenv(${JSON.stringify(auth.basicUsernameEnvVar)}, "test-user")`);
        if (auth.basicPasswordEnvVar) assignments.push(`    monkeypatch.setenv(${JSON.stringify(auth.basicPasswordEnvVar)}, "test-pass")`);
    }

    return assignments.join("\n");
}

function renderPythonOperationBehaviorTest(tool: GenerationTool): string {
    const args = getTestArgs(tool);
    const expectedPath = getExpectedPath(tool, args);
    const expectedQueryEntries = getExpectedQueryEntries(tool, args);
    const headerParams = tool.params.filter((param) => param.location === "header");
    const cookieParams = tool.params.filter((param) => param.location === "cookie");
    const requestBody = tool.requestBody;
    const assertions: string[] = [
        `    assert call["method"] == ${JSON.stringify(tool.method)}`,
        `    assert call["url"] == ${toPythonStringLiteral(`https://unit.example.test${expectedPath}`)}`,
        `    for item in ${toPythonLiteral(expectedQueryEntries)}:`,
        `        assert tuple(item) in call["params"]`,
    ];

    for (const param of headerParams) {
        assertions.push(`    assert call["headers"][${JSON.stringify(param.sourceName)}] == ${JSON.stringify(expectedSerializedParameterValue(param.sourceName, args[param.argName], { location: "header", style: param.style, explode: param.explode }))}`);
    }

    for (const param of cookieParams) {
        assertions.push(`    assert call["cookies"][${JSON.stringify(param.sourceName)}] == ${JSON.stringify(expectedSerializedParameterValue(param.sourceName, args[param.argName], { location: "cookie", style: param.style, explode: param.explode }))}`);
    }

    if (requestBody?.contentKind === "flattenedObject" || requestBody?.contentKind === "rawJsonObject" || requestBody?.contentKind === "rawArray") {
        assertions.push(`    assert call["headers"]["Content-Type"] == ${JSON.stringify(requestBody.contentType)}`);
        assertions.push(`    assert call["json"] == ${toPythonLiteral(getExpectedJsonBody(tool, args))}`);
    } else if (requestBody?.contentKind === "formUrlencoded") {
        const entries = Object.fromEntries(requestBody.params.map((param) => [param.sourceName, args[param.argName]]));
        assertions.push(`    assert call["headers"]["Content-Type"] == ${JSON.stringify(requestBody.contentType)}`);
        assertions.push(`    assert call["data"] == ${toPythonLiteral(entries)}`);
    } else if (requestBody?.contentKind === "multipart") {
        for (const param of requestBody.params) {
            if (isMultipartBinaryParam(param)) {
                assertions.push(`    assert call["files"][${JSON.stringify(param.sourceName)}][0] == ${JSON.stringify(param.sourceName)}`);
                assertions.push(`    assert call["files"][${JSON.stringify(param.sourceName)}][1] == b"file content"`);
                assertions.push(`    assert call["files"][${JSON.stringify(param.sourceName)}][2] == "application/octet-stream"`);
            } else {
                assertions.push(`    assert call["files"][${JSON.stringify(param.sourceName)}] == (None, ${JSON.stringify(scalarToExpectedString(args[param.argName]))})`);
            }
        }
    } else if (requestBody?.contentKind === "text") {
        assertions.push(`    assert call["headers"]["Content-Type"] == ${JSON.stringify(requestBody.contentType)}`);
        assertions.push(`    assert call["content"] == ${JSON.stringify(scalarToExpectedString(args[requestBody.params[0]?.argName || "body"]))}`);
    } else if (requestBody?.contentKind === "binary") {
        assertions.push(`    assert call["headers"]["Content-Type"] == ${JSON.stringify(requestBody.contentType)}`);
        assertions.push(`    assert call["content"] == base64.b64decode(args[${JSON.stringify(requestBody.params[0]?.argName || "body")}])`);
    }

    return `def test_${tool.functionName}_operation_builds_api_request(monkeypatch) -> None:
    api_client, operations, _serialization = load_modules(monkeypatch)
    fake_client = FakeClient()
    monkeypatch.setattr(api_client, "client", fake_client)
    args = ${toPythonLiteral(args)}

    operations.${tool.functionName}_operation(**args)

    call = fake_client.calls[-1]
${assertions.join("\n")}`;
}

function renderPythonTest(plan: GenerationPlan): string {
    return `from __future__ import annotations

import base64
import importlib
import sys
from pathlib import Path

import pytest

from fastmcp.exceptions import ToolError


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))


class FakeResponse:
    def __init__(self, *, status_code: int = 200, text: str = '{"ok": true}', json_body: object | None = None) -> None:
        self.status_code = status_code
        self.text = text
        self.headers = {"content-type": "application/json"}
        self._json_body = {"ok": True} if json_body is None else json_body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_bytes(self):
        yield self.text.encode("utf-8")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}: {self.text}")

    def json(self) -> object:
        return self._json_body


class FakeClient:
    def __init__(self, response: FakeResponse | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self.response = response or FakeResponse()

    def stream(self, **kwargs: object) -> FakeResponse:
        self.calls.append(kwargs)
        return self.response


def load_modules(monkeypatch):
${renderPythonAuthEnvAssignments(plan)}
    import config
    import api_client
    import operations
    import serialization

    importlib.reload(config)
    importlib.reload(api_client)
    importlib.reload(operations)
    importlib.reload(serialization)
    return api_client, operations, serialization


def test_request_api_constructs_urls_and_reports_http_errors(monkeypatch) -> None:
    api_client, _operations, _serialization = load_modules(monkeypatch)
    fake_client = FakeClient()
    monkeypatch.setattr(api_client, "client", fake_client)

    api_client.request_api(
        method="GET",
        path="/reports/alpha",
        headers={"Accept": "application/json"},
        params=[("q", "a b")],
        cookies={"session": "cookie-value"},
    )

    call = fake_client.calls[-1]
    assert call["method"] == "GET"
    assert call["url"] == "https://unit.example.test/reports/alpha"
    assert call["headers"] == {"Accept": "application/json"}
    assert call["params"] == [("q", "a b")]
    assert call["cookies"] == {"session": "cookie-value"}

    # Upstream failures are surfaced as ToolError (an isError tool result) so the
    # model can self-correct rather than the tool call failing opaquely.
    with pytest.raises(ToolError, match="HTTP 418"):
        api_client.response_to_tool_result(FakeResponse(status_code=418, text="teapot"))


def test_upstream_reads_are_bounded_and_errors_redacted(monkeypatch) -> None:
    api_client, _operations, _serialization = load_modules(monkeypatch)
    fake_client = FakeClient(FakeResponse(text="x" * 1_048_577))
    monkeypatch.setattr(api_client, "client", fake_client)
    kwargs = dict(method="GET", path="/large", headers={}, params=[], cookies={})
    with pytest.raises(ToolError, match="1 MiB limit"):
        api_client.request_api(**kwargs)
    assert fake_client.calls[-1]["follow_redirects"] is False
    fake_client.response = FakeResponse(status_code=500, text="private upstream diagnostic")
    with pytest.raises(ToolError, match=r"^Upstream returned HTTP 500\.$"):
        api_client.request_api(**kwargs)


def test_serialization_helpers_encode_paths_and_queries(monkeypatch) -> None:
    _api_client, _operations, serialization = load_modules(monkeypatch)

    assert serialization.serialize_path_parameter(
        "ids",
        ["a", "b"],
        {"location": "path", "style": "matrix", "explode": True},
    ) == ";ids=a;ids=b"

    params: list[tuple[str, str]] = []
    serialization.append_serialized_parameter(
        params,
        "filter",
        {"status": "open"},
        {"location": "query", "style": "deepObject", "explode": True},
    )
    serialization.append_serialized_parameter(
        params,
        "tags",
        ["a", "b"],
        {"location": "query", "style": "form", "explode": True},
    )
    assert params == [("filter[status]", "open"), ("tags", "a"), ("tags", "b")]


def test_apply_auth_injects_headers_query_parameters_and_cookies(monkeypatch) -> None:
    api_client, _operations, _serialization = load_modules(monkeypatch)
    params: list[tuple[str, str]] = []
    headers: dict[str, str] = {}
    cookies: dict[str, str] = {}

    api_client.apply_auth(
        params=params,
        headers=headers,
        cookies=cookies,
        auth_requirements=[{
            "schemes": [
                {"type": "apiKey", "in": "header", "name": "X-API-Key", "value": "key"},
                {"type": "apiKey", "in": "query", "name": "api_key", "value": "query-key"},
                {"type": "apiKey", "in": "cookie", "name": "session", "value": "cookie-value"},
            ],
        }],
    )

    assert headers["X-API-Key"] == "key"
    assert ("api_key", "query-key") in params
    assert cookies["session"] == "cookie-value"


${plan.tools.map(renderPythonOperationBehaviorTest).join("\n\n")}
`;
}

export function generatePythonProject(plan: GenerationPlan): GeneratedProject {
    const files = new Map<string, string>();
    const manifest = buildManifest(plan, "python");

    files.set("pyproject.toml", `[project]
name = ${JSON.stringify(plan.server.name)}
version = ${JSON.stringify(plan.server.version)}
description = ${JSON.stringify(`MCP server generated by mcpmint ${plan.generatorVersion}`)}
requires-python = ">=3.10"
dependencies = [
    "fastmcp==${FASTMCP_VERSION}",
    "httpx==0.28.1",
    "jsonschema==4.26.0",
    "python-dotenv==1.1.0",${pythonNeedsHttpServer(plan) ? `
    "uvicorn==0.35.0",
    "starlette==1.0.1",` : ""}
]
${plan.features.tests ? `
[project.optional-dependencies]
test = ["pytest==8.0.0"]
` : ""}

[build-system]
requires = ["hatchling==1.25.0"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
only-include = ["src"]
sources = ["src"]

# Cross-check field for the MCP registry: must equal the server.json \`name\`,
# proving the published package and the registry entry share an owner.
[tool.mcp]
name = ${JSON.stringify(`io.github.OWNER/${sanitizeServerId(plan.server.name)}`)}
`);

    files.set(".env.example", getEnvExample(plan));
    files.set("src/server.py", renderServer(plan));
    files.set("src/config.py", renderConfig(plan));
    files.set("src/validation.py", `from __future__ import annotations
from fastmcp.exceptions import ToolError


def normalized_schema(value):
    if isinstance(value, list):
        return [normalized_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: normalized_schema(child) for key, child in value.items() if key != "nullable"}
    if result.get("type") == "file":
        result["type"] = "string"
    if value.get("nullable") and "type" in result:
        types = result["type"] if isinstance(result["type"], list) else [result["type"]]
        result["type"] = list(dict.fromkeys(types + ["null"]))
    for keyword, bound in [("exclusiveMinimum", "minimum"), ("exclusiveMaximum", "maximum")]:
        if isinstance(result.get(keyword), bool):
            exclusive = result.pop(keyword)
            if exclusive and bound in result:
                result[keyword] = result.pop(bound)
    return result


def validate_arguments(schema, arguments):
    from jsonschema import Draft202012Validator, FormatChecker
    required = set(schema.get("required", []))
    supplied = {key: value for key, value in arguments.items() if value is not None or key in required}
    error = next(Draft202012Validator(normalized_schema(schema), format_checker=FormatChecker()).iter_errors(supplied), None)
    if error is not None:
        path = ".".join(str(part) for part in error.absolute_path) or "arguments"
        raise ToolError(f"Invalid {path}: {error.message}")
`);
    files.set("src/api_client.py", renderApiClient());
    files.set("src/operations.py", renderOperations(plan));
    files.set("src/serialization.py", renderSerialization());
    if (pythonNeedsHttpServer(plan)) {
        files.set("src/access.py", renderAccess(plan));
    }
    files.set("src/__init__.py", "");
    files.set("mcpmint.manifest.json", JSON.stringify(manifest, null, 2));
    files.set("mcpmint.sbom.json", renderSbom(plan));
    files.set("mcpmint.provenance.json", renderProvenance(plan, manifest));
    files.set("mcpmint.dependencies.lock.json", renderDependencyLock(plan));
    files.set("THIRD_PARTY_LICENSES.md", renderLicenseSummary(plan));
    files.set(".github/dependabot.yml", renderDependabot(plan));
    const pin = runtimePin(plan);
    files.set(pin.name, pin.content);
    files.set("server.json", renderServerJson(plan));

    if (plan.features.documentation) {
        files.set("README.md", renderReadme(plan));
    }

    if (plan.features.docker) {
        files.set("Dockerfile", renderDockerfile(plan));
        files.set("docker-compose.yml", renderDockerCompose(plan));
        files.set(".dockerignore", "__pycache__/\n.env\n.pytest_cache/\n");
    }

    if (plan.features.tests) {
        files.set("tests/test_behavior.py", renderPythonTest(plan));
    }

    return { manifest, files };
}
