/** Validate graph shape before recursive parsers, persistence, or code generation. */
export function assertBoundedJson(value: unknown, maxDepth = 48, maxNodes = 100_000): void {
    let nodes = 0;
    const ancestors = new WeakSet<object>();
    function walk(current: unknown, depth: number): void {
        if (++nodes > maxNodes || depth > maxDepth) throw new Error("This document exceeds the supported nesting or size limit.");
        if (current === null || typeof current !== "object") return;
        if (ancestors.has(current)) throw new Error("Recursive schema references are not supported yet. Use a finite schema and re-import.");
        ancestors.add(current);
        for (const child of Object.values(current)) walk(child, depth + 1);
        ancestors.delete(current);
    }
    walk(value, 0);
}
