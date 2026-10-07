import http from "node:http";
const port = Number(process.env.DEMO_API_PORT || 8787);
const pets = [{ id: 1, name: "Milo", status: "available", category: "cats", tags: ["demo"] }];
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  function reply(status, body) { response.writeHead(status); response.end(JSON.stringify(body)); }
  if (request.method !== "GET") return reply(405, { error: "This demo provides read-only tools." });
  if (url.pathname === "/ping") return reply(200, { status: "ok", source: "local demo" });
  if (url.pathname === "/protected/ping") {
    if (request.headers.authorization !== "Bearer demo-token") return reply(401, { error: "Use the demo bearer token from the quickstart." });
    return reply(200, { status: "ok", source: "authenticated local demo" });
  }
  if (url.pathname === "/api/v1/pets") return reply(200, pets);
  if (/^\/api\/v1\/pets\/[^/]+$/.test(url.pathname)) return reply(200, { ...pets[0], id: Number(url.pathname.split("/").pop()) || 1 });
  if (url.pathname === "/api/v1/store/inventory") return reply(200, { available: 1, pending: 0, sold: 0 });
  if (/^\/api\/v1\/store\/orders\/[^/]+$/.test(url.pathname)) return reply(200, { id: 1, petId: 1, quantity: 1, status: "placed", complete: false });
  if (/^\/api\/v1\/users\/[^/]+$/.test(url.pathname)) return reply(200, { id: 1, username: decodeURIComponent(url.pathname.split("/").pop()), email: "demo@example.com" });
  return reply(404, { error: "Demo route not found. Use /ping or the documented sample endpoints." });
});
server.listen(port, "127.0.0.1", () => console.log(`Read-only demo API: http://127.0.0.1:${port}/ping`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
