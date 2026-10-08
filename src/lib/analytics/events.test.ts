import assert from "node:assert/strict";
import test from "node:test";
import { analyticsProperties, sanitizeAnalyticsEvent, knownRoute, toolCountBucket } from "./events.ts";
test("analytics excludes specs, errors, names, SDK URLs and person properties", () => {
    const event = sanitizeAnalyticsEvent({ event: "generation_succeeded", uuid: "test", properties: {
        language: "node", transport: "http", execution: "browser", tool_count: "1-5", duration_ms: 1.6,
        spec: "PRIVATE", error: "PRIVATE", projectName: "PRIVATE", $current_url: "https://example.com?token=PRIVATE", $referrer: "PRIVATE", $initial_person_info: { secret: "PRIVATE" }, distinct_id: "anonymous-id",
    }, $set: { secret: "PRIVATE" }, $set_once: { source: "PRIVATE" } });
    assert.ok(event);
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE/);
    assert.equal(event.properties.distinct_id, "anonymous-id");
    assert.equal(event.properties.duration_ms, 2);
    assert.equal(event.properties.$geoip_disable, true);
    assert.equal(event.properties.$process_person_profile, false);
});
test("unknown and automatic capture events cannot pass the outbound boundary", () => {
    for (const event of ["$autocapture", "$snapshot", "$exception", "$identify", "$pageleave", "custom_private_event"]) assert.equal(sanitizeAnalyticsEvent({ event, properties: { text: "PRIVATE" } }), null);
});
test("properties accept only declared categories and finite bounded durations", () => {
    assert.deepEqual(analyticsProperties("import_succeeded", { source: "private filename", format: "private format", duration_ms: NaN }), {});
    assert.deepEqual(analyticsProperties("first_tool_call_completed", { client: "cursor", confirmation: "machine_verified", language: "python", transport: "stdio" }), { client: "cursor", language: "python", transport: "stdio" });
    assert.equal(knownRoute("/import?token=PRIVATE"), undefined);
    assert.equal(knownRoute("/import"), "/import");
    assert.deepEqual([0, 1, 6, 26, 101].map(toolCountBucket), ["0", "1-5", "6-25", "26-100", "100+"]);
});
