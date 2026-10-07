"use client";
import type { PostHog } from "posthog-js";
import { analyticsProperties, sanitizeAnalyticsEvent, type AnalyticsEvent } from "./events";
const optOutKey = "mcpmint-analytics-opt-out";
let client: PostHog | undefined;
let initialization: Promise<void> | undefined;
const queue: Array<{ event: AnalyticsEvent; properties: Record<string, unknown> }> = [];
export function analyticsOptedOut(): boolean {
    if (typeof window === "undefined") return true;
    if (navigator.doNotTrack === "1") return true;
    try { return localStorage.getItem(optOutKey) === "1"; } catch { return true; }
}
export function initializeAnalytics(): Promise<void> {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || analyticsOptedOut()) return Promise.resolve();
    if (initialization) return initialization;
    initialization = import("posthog-js/no-external").then(({ default: posthog }) => {
        if (analyticsOptedOut()) { queue.length = 0; initialization = undefined; return; }
        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
            defaults: "2026-05-30",
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
            persistence: "memory", internal_or_test_user_hostname: null, person_profiles: "never", respect_dnt: true, ip: false,
            autocapture: false, capture_pageview: false, capture_pageleave: false,
            disable_session_recording: true, enable_recording_console_log: false,
            capture_exceptions: false, capture_performance: false, capture_heatmaps: false, capture_dead_clicks: false,
            disable_surveys: true, advanced_disable_flags: true, disable_external_dependency_loading: true,
            before_send: sanitizeAnalyticsEvent,
        });
        // Initialization is allowed only by our current browser preference.
        // Restore SDK consent when a previous opt-out survived a full reload.
        if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
        client = posthog;
        for (const entry of queue.splice(0)) posthog.capture(entry.event, entry.properties);
    }).catch(() => { console.warn("Product analytics could not initialize; collection is disabled."); queue.length = 0; initialization = undefined; });
    return initialization;
}
export function trackEvent(event: AnalyticsEvent, input: Record<string, unknown> = {}): void {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || analyticsOptedOut()) return;
    const properties = analyticsProperties(event, input);
    if (client) client.capture(event, properties);
    else { if (queue.length < 20) queue.push({ event, properties }); void initializeAnalytics(); }
}
export function setAnalyticsOptOut(optOut: boolean): boolean {
    try { localStorage.setItem(optOutKey, optOut ? "1" : "0"); } catch { return false; }
    if (optOut) { queue.length = 0; client?.opt_out_capturing(); }
    else { client?.opt_in_capturing({ captureEventName: false }); void initializeAnalytics(); }
    return true;
}
