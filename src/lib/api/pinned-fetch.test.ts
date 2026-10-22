import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pinnedGet } from "./pinned-fetch.ts";

test("pinnedGet dials the pinned IP and sends Host for the logical hostname", async () => {
    let seenHost: string | undefined;
    let seenUrl: string | undefined;

    const server = http.createServer((req, res) => {
        seenHost = req.headers.host;
        seenUrl = req.url;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok-body");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
        // Logical hostname is example.test; connection is forced to 127.0.0.1.
        const url = new URL(`http://example.test:${port}/openapi.json`);
        const response = await pinnedGet(url, "127.0.0.1", {
            headers: { Accept: "application/json" },
        });

        assert.equal(response.status, 200);
        assert.equal(await response.text(), "ok-body");
        assert.equal(seenHost, `example.test:${port}`);
        assert.equal(seenUrl, "/openapi.json");
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});

test("pinnedGet rejects invalid pinned IPs", async () => {
    await assert.rejects(
        () => pinnedGet(new URL("http://example.com/"), "not-an-ip"),
        /pinnedIp/
    );
});

test("pinnedGet returns a body-less response for 204 instead of throwing", async () => {
    const server = http.createServer((_req, res) => {
        res.writeHead(204);
        res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
        const response = await pinnedGet(new URL(`http://example.test:${port}/`), "127.0.0.1");
        assert.equal(response.status, 204);
        assert.equal(response.body, null);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});
