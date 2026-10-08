import { assertGraphBudget } from "../processing/limits.ts";

/** Resolve local refs while retaining a finite reference at recursive edges. Never fetch remote content. */
export function resolveLocalReferences(
  input: unknown,
): Record<string, unknown> {
  assertGraphBudget(input);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("The specification must be a JSON/YAML object.");
  const root = input as Record<string, unknown>;
  let expanded = 0;
  function visit(value: unknown, depth: number, active: Set<string>): unknown {
    if (++expanded > 250_000 || depth > 64)
      throw new Error(
        "Reference expansion is too complex. Reduce or pre-bundle the specification.",
      );
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1, active));
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const ref = record.$ref;
      if (!ref.startsWith("#/"))
        throw new Error(
          "External schema references are not fetched in private mode. Bundle the specification into one file before importing.",
        );
      if (active.has(ref)) return { $ref: ref };
      let target: unknown = root;
      for (const part of ref.slice(2).split("/")) {
        let key: string;
        try {
          key = decodeURIComponent(part)
            .replace(/~1/g, "/")
            .replace(/~0/g, "~");
        } catch {
          throw new Error(`Invalid local reference: ${ref}`);
        }
        if (
          !target ||
          typeof target !== "object" ||
          !Object.hasOwn(target, key)
        )
          throw new Error(`Local reference was not found: ${ref}`);
        target = (target as Record<string, unknown>)[key];
      }
      const next = new Set(active);
      next.add(ref);
      const resolved = visit(target, depth + 1, next);
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved))
        throw new Error(`Local reference must point to an object: ${ref}`);
      const siblings = Object.fromEntries(
        Object.entries(record)
          .filter(([key]) => key !== "$ref")
          .map(([key, item]) => [key, visit(item, depth + 1, active)]),
      );
      return { ...resolved, ...siblings };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        visit(item, depth + 1, active),
      ]),
    );
  }
  return visit(root, 0, new Set()) as Record<string, unknown>;
}
