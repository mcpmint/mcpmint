export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
export const MAX_OPERATIONS = 10_000;
export const MAX_SELECTED_TOOLS = 500;
export const MAX_GRAPH_DEPTH = 64;
export const MAX_GRAPH_NODES = 250_000;
export const PROCESSING_TIMEOUT_MS = 60_000;

export function assertTextSize(text: string, maxBytes = MAX_SPEC_BYTES): void {
  if (
    text.length > maxBytes ||
    new TextEncoder().encode(text).byteLength > maxBytes
  ) {
    throw new Error(
      `This file is larger than ${maxBytes / 1024 / 1024} MB. Split or reduce it before importing.`,
    );
  }
}

export function assertSpecFile(
  file: Pick<File, "size" | "name">,
  project = false,
): void {
  const max = project ? MAX_PROJECT_BYTES : MAX_SPEC_BYTES;
  if (file.size > max)
    throw new Error(
      `This file is larger than ${max / 1024 / 1024} MB. Split or reduce it before importing.`,
    );
  if (!(project ? /\.json$/i : /\.(json|yaml|yml)$/i).test(file.name)) {
    throw new Error(
      project
        ? "Choose a .mcpmint.json project file."
        : "Choose one OpenAPI, Swagger, or Postman JSON/YAML file.",
    );
  }
}

/** Bound decoded input and refuse graphs that cannot safely cross JSON/worker boundaries. */
export function assertGraphBudget(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [
    { value, depth: 0 },
  ];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) {
      ancestors.delete(item.value as object);
      continue;
    }
    if (++nodes > MAX_GRAPH_NODES || item.depth > MAX_GRAPH_DEPTH) {
      throw new Error(
        "This specification is too deeply nested or complex. Reduce it or bundle a smaller set of endpoints.",
      );
    }
    if (!item.value || typeof item.value !== "object") continue;
    if (ancestors.has(item.value))
      throw new Error(
        "Circular object aliases are unsupported. Use JSON Schema $ref references instead.",
      );
    ancestors.add(item.value);
    stack.push({ ...item, exit: true });
    for (const child of Object.values(item.value))
      stack.push({ value: child, depth: item.depth + 1 });
  }
}

export function processingError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError")
    return "Processing cancelled.";
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues
      .slice(0, 3)
      .map((issue) => {
        const item = issue as {
          path?: Array<string | number>;
          message?: string;
        };
        return `${item.path?.join(".") || "Project"}: ${item.message || "Invalid value"}`;
      })
      .join("; ");
  }
  return error instanceof Error
    ? error.message
    : "Could not process this file. Check its format and try again.";
}
