import type { GenerationPlan } from "../types.ts";

// Hosts that count as "localhost" for the deny-by-default origin policy shared by the
// Node and Python targets. When no allowed origins are configured, only these are accepted
// for HTTP transports (mitigating DNS-rebinding against locally-bound servers).
export const LOCALHOST_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as const;

interface NodeTransportStrategy {
    imports: string;
    bootstrap: string;
}

export function getNodeTransportStrategy(plan: GenerationPlan): NodeTransportStrategy {
    switch (plan.runtime.transportStrategy) {
        case "stdio":
            return {
                imports: 'import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";',
                bootstrap: `  const server = createServer();\n  const transport = new StdioServerTransport();\n  await server.connect(transport);\n  console.error(${JSON.stringify(`${plan.server.name} MCP server running on stdio`)});`,
            };
        case "sse":
            return {
                imports: 'import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";\nimport http from "http";',
                bootstrap: `  const sessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();\n  const handleSseRequest = async (req: any, res: any) => {\n    const requestUrl = new URL(req.url || "/", \`http://\${MCP_SERVER_CONFIG.host}:\${MCP_SERVER_CONFIG.port}\`);\n    if (handleMcpPreflight(req, res)) return;\n    if (!authorizeMcpRequest(req, res)) return;\n\n    if (req.method === "GET" && requestUrl.pathname === "/sse") {\n      const transport = new SSEServerTransport("/messages", res);\n      const sessionId = transport.sessionId;\n      const server = createServer();\n      sessions.set(sessionId, { transport, server });\n      transport.onclose = () => {\n        sessions.delete(sessionId);\n      };\n      await server.connect(transport);\n      return;\n    }\n\n    if (req.method === "POST" && requestUrl.pathname === "/messages") {\n      const sessionId = requestUrl.searchParams.get("sessionId");\n      if (!sessionId) {\n        res.writeHead(400);\n        res.end("Missing sessionId parameter");\n        return;\n      }\n\n      const session = sessions.get(sessionId);\n      if (!session) {\n        res.writeHead(404);\n        res.end("Session not found");\n        return;\n      }\n\n      await session.transport.handlePostMessage(req, res);\n      return;\n    }\n\n    res.writeHead(404);\n    res.end();\n  };\n  const httpServer = http.createServer(async (req: any, res: any) => {\n    try {\n      await handleSseRequest(req, res);\n    } catch (error) {\n      console.error("Error handling MCP request:", error);\n      if (!res.headersSent) res.writeHead(500);\n      res.end();\n    }\n  });\n  httpServer.listen(MCP_SERVER_CONFIG.port, MCP_SERVER_CONFIG.host, () => {\n    console.log(${JSON.stringify(`${plan.server.name} MCP server running on http://${plan.server.host}:${plan.server.port}`)});\n  });`,
            };
        default:
            // Streamable HTTP is configured session-light / stateless: a fresh
            // McpServer + transport is created per POST and StreamableHTTPServerTransport
            // is constructed with `sessionIdGenerator: undefined`, so no server-managed
            // session id is issued or required. This is the forward-compatible direction
            // for the stateless (2026-07-28) spec revision and keeps horizontal scaling
            // trivial (no sticky sessions). Security enforcement is unchanged: the
            // preflight (handleMcpPreflight) and bearer + Origin checks (authorizeMcpRequest)
            // still run before any request is handled. Do not add a mandatory session id
            // generator here without re-validating against the pinned SDK version and the
            // transport test that asserts this exact stateless construction.
            return {
                imports: 'import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";\nimport http from "http";',
                bootstrap: `  const httpServer = http.createServer(async (req: any, res: any) => {\n    if (handleMcpPreflight(req, res)) return;\n    if (!authorizeMcpRequest(req, res)) return;\n\n    if (req.method !== "POST") {\n      res.writeHead(405, { "Content-Type": "application/json" });\n      res.end(JSON.stringify({\n        jsonrpc: "2.0",\n        error: {\n          code: -32000,\n          message: "Method not allowed.",\n        },\n        id: null,\n      }));\n      return;\n    }\n\n    const server = createServer();\n    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });\n\n    try {\n      await server.connect(transport);\n      await transport.handleRequest(req, res);\n    } catch (error) {\n      console.error("Error handling MCP request:", error);\n      if (!res.headersSent) {\n        res.writeHead(500, { "Content-Type": "application/json" });\n        res.end(JSON.stringify({\n          jsonrpc: "2.0",\n          error: {\n            code: -32603,\n            message: "Internal server error",\n          },\n          id: null,\n        }));\n      }\n    }\n  });\n  httpServer.listen(MCP_SERVER_CONFIG.port, MCP_SERVER_CONFIG.host, () => {\n    console.log(${JSON.stringify(`${plan.server.name} MCP server running on http://${plan.server.host}:${plan.server.port}`)});\n  });`,
            };
    }
}

export function getPythonTransportRunLine(plan: GenerationPlan): string {
    if (plan.runtime.transportStrategy === "stdio") {
        return '    mcp.run(transport="stdio")';
    }

    const transport = plan.runtime.transportStrategy === "streamableHttp"
        ? "http"
        : plan.runtime.transportStrategy;

    // HTTP/SSE transports build the FastMCP ASGI app with an access-control middleware
    // (Origin validation + bearer auth) and serve it via uvicorn, matching the Node target.
    // The uvicorn/access imports are deferred into __main__ so that a bare `import server`
    // (used by fast verification and tooling) does not require the runtime HTTP dependencies.
    return `    import uvicorn
    from access import assert_mcp_server_access_config, build_mcp_access_middleware

    assert_mcp_server_access_config()
    app = mcp.http_app(transport=${JSON.stringify(transport)}, middleware=build_mcp_access_middleware())
    uvicorn.run(app, host=MCP_SERVER_CONFIG["host"], port=MCP_SERVER_CONFIG["port"])`;
}

// Whether the Python HTTP server needs uvicorn + the access middleware imports.
export function pythonNeedsHttpServer(plan: GenerationPlan): boolean {
    return plan.runtime.transportStrategy !== "stdio";
}
