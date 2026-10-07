import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("semantic status colors are exported as Tailwind theme tokens", () => {
    const css = read("globals.css");
    for (const color of ["green", "blue", "amber", "red"]) {
        assert.match(css, new RegExp(`--color-${color}: var\\(--${color}\\)`));
    }
});

test("motion-heavy UI honors reduced-motion preferences", () => {
    assert.match(read("globals.css"), /prefers-reduced-motion:\s*reduce/);
});

function contrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string) => {
        const channels = hex.match(/[0-9a-f]{2}/gi)?.map((channel) => parseInt(channel, 16) / 255) || [];
        const linear = channels.map((channel) => channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4);
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    };
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

test("muted text meets WCAG AA contrast in dark and light themes", () => {
    const css = read("globals.css");
    const dark = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    const light = css.match(/\.light\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    const value = (block: string, token: string) => block.match(new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] || "";

    assert.ok(contrastRatio(value(dark, "muted-foreground"), value(dark, "background")) >= 4.5);
    assert.ok(contrastRatio(value(light, "muted-foreground"), value(light, "background")) >= 4.5);
});

test("endpoint rows and selection controls expose keyboard and accessible-name contracts", () => {
    const editor = read("editor/page.tsx");
    assert.doesNotMatch(editor, /role="button"/);
    assert.match(editor, /aria-expanded=\{isExpanded\}/);
    assert.match(editor, /aria-label=\{`Include \$\{ep\.method\} \$\{ep\.path\}`\}/);
});

test("icon-only GitHub navigation has an accessible name", () => {
    assert.match(read("../components/shared/header.tsx"), /aria-label="Open mcpmint on GitHub"/);
    assert.match(read("../components/shared/marketing-header.tsx"), /aria-label="Open mcpmint on GitHub"/);
});

test("homepage content and transformation proof do not depend on hydration to become visible", () => {
    const page = read("page.tsx");
    const scene = read("../components/marketing/api-mint-scene.tsx");

    assert.doesNotMatch(page, /mounted\s*\?\s*"opacity-100"/);
    assert.match(page, /MarketingHeader/);
    assert.match(scene, /aria-labelledby=/);
    assert.match(scene, /Generated server summary/);
});

test("mobile export uses native progressive disclosure for advanced evidence", () => {
    const exportPage = read("export/page.tsx");
    assert.match(exportPage, /function ResponsiveDisclosure/);
    assert.match(exportPage, /<details open className="progressive-section/);
    assert.match(exportPage, /focus-visible:outline-2/);
});

test("system theme responds to operating-system theme changes", () => {
    const provider = read("../components/theme-provider.tsx");
    assert.match(provider, /addEventListener\("change", applyTheme\)/);
    assert.match(provider, /removeEventListener\("change", applyTheme\)/);
});
