"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initializeAnalytics, trackEvent } from "@/lib/analytics/client";
import { knownRoute } from "@/lib/analytics/events";
export function ProductAnalytics() {
    const pathname = usePathname();
    useEffect(() => {
        void initializeAnalytics();
        const route = knownRoute(pathname);
        if (route) trackEvent("$pageview", { route });
    }, [pathname]);
    return null;
}
