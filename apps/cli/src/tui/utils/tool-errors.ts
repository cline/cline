export interface ToolErrorPresentation {
	severity: "warning" | "error";
	summary: string;
	detail: string;
}

const MAX_ERROR_SUMMARY_LENGTH = 140;

function extractStringError(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value.trim() || undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return (
		extractStringError(record.error) ??
		extractStringError(record.message) ??
		undefined
	);
}

export function unwrapToolError(error: string): string {
	let current = error.trim();
	for (let i = 0; i < 3; i += 1) {
		if (!current.startsWith("{") && !current.startsWith("[")) break;
		try {
			const parsed = JSON.parse(current) as unknown;
			const next = extractStringError(parsed);
			if (!next || next === current) break;
			current = next.trim();
		} catch {
			break;
		}
	}
	return current;
}

function summarizeInvalidInput(message: string): string | undefined {
	const rejected = message.match(
		/^Tool call\s+([A-Za-z0-9_-]+)\s+was rejected before execution:\s+Invalid input for tool\s+([A-Za-z0-9_-]+):\s*([^.\n]+)(?:\.|\n|$)/,
	);
	if (rejected) {
		return `Invalid ${rejected[2]} input; tool call skipped.`;
	}

	const invalid = message.match(
		/^Invalid input for tool\s+([A-Za-z0-9_-]+):\s*([^.\n]+)(?:\.|\n|$)/,
	);
	if (invalid) {
		return `Invalid ${invalid[1]} input; tool call skipped.`;
	}

	return undefined;
}

function truncateSummary(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_ERROR_SUMMARY_LENGTH) {
		return trimmed;
	}
	return `${trimmed.slice(0, MAX_ERROR_SUMMARY_LENGTH - 3).trimEnd()}...`;
}

function summarizeErrorDetail(detail: string): string {
	const trimmed = detail.trim();
	if (!trimmed) {
		return "Tool failed.";
	}

	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return "Tool returned a structured error.";
	}

	const firstLine =
		trimmed
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean) ?? "Tool failed.";
	const withoutGenericPrefix = firstLine.replace(/^Error:\s+/i, "");

	return truncateSummary(withoutGenericPrefix.replace(/\s+/g, " "));
}

export function getToolErrorPresentation(error: string): ToolErrorPresentation {
	const detail = unwrapToolError(error);
	const inputSummary = summarizeInvalidInput(detail);
	if (inputSummary) {
		return {
			severity: "warning",
			summary: inputSummary,
			detail,
		};
	}

	const rejected = detail.match(
		/^Tool call\s+([A-Za-z0-9_-]+)\s+was rejected before execution:/,
	);
	if (rejected) {
		return {
			severity: "warning",
			summary: `${rejected[1]} call was skipped before execution.`,
			detail,
		};
	}

	return {
		severity: "error",
		summary: summarizeErrorDetail(detail),
		detail,
	};
}

export function isWarningToolError(error: string | undefined): boolean {
	return error ? getToolErrorPresentation(error).severity === "warning" : false;
}
