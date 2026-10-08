const MAX_SCHEMA_DEPTH = 24;
const MAX_SCHEMA_PROPERTIES = 200;
const MAX_COMPOSITION_MEMBERS = 32;

export function toZodType(type: string, schema?: Record<string, unknown>): string {
    return schemaToZodType(schema || { type: type.toLowerCase() });
}

/** Emit validation without silently widening a bounded or unsupported schema. */
export function schemaToZodType(schema: Record<string, unknown>, depth = 0, seen = new WeakSet<object>()): string {
    if (typeof schema === "boolean") return schema ? "z.unknown()" : "z.never()";
    if (!schema || typeof schema !== "object") throw new Error("Invalid JSON Schema fragment.");
    if (depth > MAX_SCHEMA_DEPTH || seen.has(schema)) throw new Error("Schema nesting or recursion exceeds the supported generation limit.");
    seen.add(schema);
    try {
        const expression = convert(schema, depth, seen);
        return schema.nullable === true && schema.type !== "null" ? `${expression}.nullable()` : expression;
    } finally { seen.delete(schema); }
}

function convert(schema: Record<string, unknown>, depth: number, seen: WeakSet<object>): string {
    const recurse = (child: Record<string, unknown>) => schemaToZodType(child, depth + 1, seen);
    const union = (members: string[]) => members.length === 1 ? members[0] : `z.union([${members.join(", ")}])`;
    for (const kind of ["allOf", "oneOf", "anyOf"]) {
        const members = schema[kind];
        if (!Array.isArray(members) || !members.length) continue;
        if (members.length > MAX_COMPOSITION_MEMBERS) throw new Error("Schema has too many composition members.");
        const values = members.map((member) => recurse(member));
        return kind === "allOf" ? values.reduce((a, b) => `${a}.and(${b})`) : union(values);
    }
    if (Array.isArray(schema.type)) {
        if (!schema.type.length || schema.type.length > 7) throw new Error("Invalid schema type union.");
        return union(schema.type.map((type) => recurse({ ...schema, type, nullable: false })));
    }
    if (schema.const !== undefined) return `z.literal(${JSON.stringify(schema.const)})`;
    if (Array.isArray(schema.enum) && schema.enum.length) {
        if (schema.enum.length > 1 && schema.enum.every((v) => typeof v === "string")) return `z.enum([${schema.enum.map((v) => JSON.stringify(v)).join(", ")}])`;
        return union(schema.enum.map((value) => `z.literal(${JSON.stringify(value)})`));
    }
    let value: string;
    const constraint = (key: string, method: string) => {
        if (typeof schema[key] === "number" && Number.isFinite(schema[key])) value += `.${method}(${schema[key]})`;
    };
    switch (schema.type || (schema.properties || schema.additionalProperties !== undefined ? "object" : undefined)) {
        case "string":
            value = "z.string()";
            if (schema.format === "email") value += ".email()";
            if (schema.format === "uri" || schema.format === "url") value += ".url()";
            if (schema.format === "uuid") value += ".uuid()";
            constraint("minLength", "min"); constraint("maxLength", "max");
            if (typeof schema.pattern === "string") {
                try { new RegExp(schema.pattern); } catch { throw new Error("Invalid regular expression in schema.pattern."); }
                value += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`;
            }
            return value;
        case "integer":
        case "number":
            value = schema.type === "integer" ? "z.number().int()" : "z.number()";
            constraint("minimum", schema.exclusiveMinimum === true ? "gt" : "min");
            constraint("maximum", schema.exclusiveMaximum === true ? "lt" : "max");
            constraint("exclusiveMinimum", "gt"); constraint("exclusiveMaximum", "lt");
            constraint("multipleOf", "multipleOf");
            return value;
        case "boolean": return "z.boolean()";
        case "null": return "z.null()";
        case "array":
            value = `z.array(${schema.items !== undefined && (typeof schema.items === "boolean" || typeof schema.items === "object") && !Array.isArray(schema.items) ? recurse(schema.items as Record<string, unknown>) : "z.unknown()"})`;
            constraint("minItems", "min"); constraint("maxItems", "max");
            return value;
        case "object": {
            const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
            const entries = Object.entries(properties);
            if (entries.length > MAX_SCHEMA_PROPERTIES) throw new Error("Schema has too many object properties.");
            const required = new Set(Array.isArray(schema.required) ? schema.required : []);
            const fields = entries.map(([key, child]) => {
                let field = recurse(child);
                if (!required.has(key)) field += ".optional()";
                if (typeof child.description === "string") field += `.describe(${JSON.stringify(child.description)})`;
                return `${JSON.stringify(key)}: ${field}`;
            });
            value = `z.object({\n    ${fields.join(",\n    ")}\n  })`;
            if (schema.additionalProperties === false) value += ".strict()";
            else if (schema.additionalProperties && typeof schema.additionalProperties === "object") value += `.catchall(${recurse(schema.additionalProperties as Record<string, unknown>)})`;
            else value += ".passthrough()";
            if (typeof schema.minProperties === "number") value += `.refine((value) => Object.keys(value).length >= ${schema.minProperties}, "Too few object properties")`;
            if (typeof schema.maxProperties === "number") value += `.refine((value) => Object.keys(value).length <= ${schema.maxProperties}, "Too many object properties")`;
            return value;
        }
        default: return "z.unknown()";
    }
}

/** Python runtime validation consumes the complete schema; these are transport hints. */
export function toPythonType(type: string): string {
    const map: Record<string, string> = { string: "str", integer: "int", number: "float", boolean: "bool", array: "list", object: "dict" };
    return map[type.toLowerCase()] || "object";
}

/** Capabilities must disclose constraints a target cannot enforce faithfully. */
export function schemaReviewNotes(schema: unknown, seen = new WeakSet<object>()): string[] {
    if (!schema || typeof schema !== "object" || seen.has(schema)) return [];
    seen.add(schema);
    if (Array.isArray(schema)) return [...new Set(schema.flatMap((child) => schemaReviewNotes(child, seen)))];
    const record = schema as Record<string, unknown>;
    const unsupported = ["not", "discriminator", "patternProperties", "dependentSchemas", "dependentRequired", "unevaluatedProperties", "unevaluatedItems", "contains", "if", "then", "else", "propertyNames", "$ref", "$dynamicRef", "$dynamicAnchor", "prefixItems", "uniqueItems", "minContains", "maxContains", "contentEncoding"];
    const notes = unsupported.filter((key) => record[key] !== undefined && record[key] !== false)
        .map((key) => `Schema keyword ${key} needs manual review; validation is not equivalent across generated targets.`);
    if (record.oneOf) notes.push("oneOf exclusivity needs manual review: Node accepts a matching union member rather than proving exactly one match.");
    const constraints = ["minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "properties", "additionalProperties"];
    if ((record.enum || record.const !== undefined || record.allOf || record.anyOf || record.oneOf) && constraints.some((key) => record[key] !== undefined)) {
        notes.push("Schema combines composition or literals with sibling constraints; review validation in each generated target.");
    }
    return [...new Set([...notes, ...Object.values(record).flatMap((child) => schemaReviewNotes(child, seen))])];
}
