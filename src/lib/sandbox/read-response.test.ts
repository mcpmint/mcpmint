import assert from "node:assert/strict";
import test from "node:test";
import { readResponseCapped } from "./read-response.ts";
test("streamed responses stop and cancel before exceeding the byte budget", async () => {
  let cancelled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(100_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readResponseCapped(new Response(body)), /256 KiB/);
  assert.equal(cancelled, true);
  assert.ok(reads <= 4);
});
test("UTF-8 response budgets count bytes and preserve chunked multibyte text", async () => {
  const bytes = new TextEncoder().encode("ééé");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1));
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  });
  assert.equal(await readResponseCapped(new Response(body), 6), "ééé");
  await assert.rejects(readResponseCapped(new Response("ééé"), 5), /256 KiB/);
});
test("oversized declared responses are cancelled without reading", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "999999" } },
  );
  await assert.rejects(readResponseCapped(response), /256 KiB/);
  assert.equal(cancelled, true);
});
