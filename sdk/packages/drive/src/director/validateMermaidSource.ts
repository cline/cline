/**
 * Sync structural parse gate for mermaidSource (diagram-first / Show producers).
 * Pure — no mermaid runtime. Catches empty/garbage/unknown diagram types.
 * Grade: parse-validated (structural).
 */

const DIAGRAM_TYPE_RE =
	/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|C4Context|journey)\b/i;

export type MermaidParseResult =
	| { ok: true }
	| { ok: false; reason: string };

export class MermaidParseError extends Error {
	readonly code = "mermaid_parse_failed" as const;
	constructor(readonly reason: string) {
		super(`mermaid_parse_failed: ${reason}`);
		this.name = "MermaidParseError";
	}
}

/**
 * Validate Mermaid source before produce/present. Fail closed on invalid input.
 */
export function validateMermaidSource(source: string): MermaidParseResult {
	const trimmed = source.trim();
	if (!trimmed) {
		return { ok: false, reason: "empty mermaidSource" };
	}
	if (trimmed.includes("```")) {
		return {
			ok: false,
			reason: "mermaidSource must not include markdown fences",
		};
	}
	const lines = trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 0 &&
				!line.startsWith("%%") &&
				!line.startsWith("---"),
		);
	const first = lines[0] ?? "";
	if (!DIAGRAM_TYPE_RE.test(first)) {
		const preview = first.slice(0, 48) || "(blank)";
		return {
			ok: false,
			reason: `unrecognized mermaid diagram type (first line: ${preview})`,
		};
	}
	return { ok: true };
}

/** Throw MermaidParseError when source fails structural parse. */
export function assertMermaidSource(source: string): void {
	const parsed = validateMermaidSource(source);
	if (!parsed.ok) {
		throw new MermaidParseError(parsed.reason);
	}
}
