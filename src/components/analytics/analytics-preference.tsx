"use client";
import { useSyncExternalStore, useState } from "react";
import { analyticsOptedOut, setAnalyticsOptOut } from "@/lib/analytics/client";
const changeEvent = "mcpmint-analytics-preference";
function subscribe(onChange: () => void) { window.addEventListener(changeEvent, onChange); window.addEventListener("storage", onChange); return () => { window.removeEventListener(changeEvent, onChange); window.removeEventListener("storage", onChange); }; }
export function AnalyticsPreference() {
    const optedOut = useSyncExternalStore(subscribe, analyticsOptedOut, () => true);
    const [error, setError] = useState("");
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) return <p className="text-sm text-muted-foreground">Product analytics is not configured on this deployment.</p>;
    return <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Product analytics is {optedOut ? "disabled" : "enabled"} in this browser. Do Not Track also disables collection.</p>
        <button type="button" onClick={() => { if (setAnalyticsOptOut(!optedOut)) { setError(""); window.dispatchEvent(new Event(changeEvent)); } else setError("Browser storage is unavailable; analytics remains disabled."); }} className="min-h-10 border border-border px-3 text-sm text-primary">{optedOut ? "Enable product analytics" : "Disable product analytics"}</button>
        {error && <p role="alert" className="text-sm text-muted-foreground">{error}</p>}
    </div>;
}
