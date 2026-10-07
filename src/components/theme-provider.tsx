"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
}

interface ThemeProviderState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
    children,
    defaultTheme = "dark",
    // Legacy localStorage key kept intentionally so existing users' saved theme survives the mcpmint rebrand.
    storageKey = "makemcp-theme",
}: ThemeProviderProps) {
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window === "undefined") {
            return defaultTheme;
        }

        try {
            const stored = localStorage.getItem(storageKey);
            return stored === "dark" || stored === "light" || stored === "system" ? stored : defaultTheme;
        } catch { return defaultTheme; }
    });

    useEffect(() => {
        const root = window.document.documentElement;
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const applyTheme = () => {
            root.classList.remove("dark", "light");
            root.classList.add(theme === "system" ? (media.matches ? "dark" : "light") : theme);
        };

        applyTheme();
        if (theme !== "system") return;

        media.addEventListener("change", applyTheme);
        return () => media.removeEventListener("change", applyTheme);
    }, [theme]);

    const value = {
        theme,
        setTheme: (newTheme: Theme) => {
            try { localStorage.setItem(storageKey, newTheme); } catch { /* Apply the theme even if browser storage is unavailable. */ }
            setTheme(newTheme);
        },
    };

    return (
        <ThemeProviderContext.Provider value={value}>
            {children}
        </ThemeProviderContext.Provider>
    );
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext);
    // Return default values if not in ThemeProvider (SSR)
    if (context === undefined) {
        return { theme: "dark" as Theme, setTheme: () => { } };
    }
    return context;
};
