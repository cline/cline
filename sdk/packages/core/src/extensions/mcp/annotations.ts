import type { McpToolAnnotations } from "./types";

const BOOLEAN_HINTS = [
	"readOnlyHint",
	"destructiveHint",
	"idempotentHint",
	"openWorldHint",
] as const;

/**
 * Keeps only the well-typed hints from a server's `annotations` object, so a
 * malformed value (wrong type, array, string) never reaches a consumer as a
 * hint. Returns undefined when nothing usable is declared.
 */
export function normalizeMcpToolAnnotations(
	value: unknown,
): McpToolAnnotations | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const source = value as Record<string, unknown>;
	const annotations: McpToolAnnotations = {};
	if (typeof source.title === "string") {
		annotations.title = source.title;
	}
	for (const hint of BOOLEAN_HINTS) {
		if (typeof source[hint] === "boolean") {
			annotations[hint] = source[hint];
		}
	}
	return Object.keys(annotations).length > 0 ? annotations : undefined;
}
