/**
 * Some tools report failure *inside* their output payload rather than by
 * throwing, so the tool-result envelope is never flagged as an error.
 *
 * `read_files` is the common case: a missing file produces
 * `{ query, result: "", error: "Error reading file: ...", success: false }`
 * while the call itself is considered to have completed. Consumers that only
 * inspect the envelope (`isError` / `is_error`) therefore render such a result
 * as a success.
 *
 * This lifts payload-level failures into a single error string so the existing
 * error paths can present them.
 */
export function extractToolPayloadError(output: unknown): string | undefined {
	if (!Array.isArray(output) || output.length === 0) {
		return undefined;
	}

	let considered = 0;
	const failures: string[] = [];

	for (const item of output) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (typeof record.success !== "boolean") {
			continue;
		}
		considered += 1;
		if (record.success) {
			continue;
		}
		failures.push(describeFailure(record));
	}

	if (considered === 0 || failures.length === 0) {
		return undefined;
	}

	const [first, ...rest] = failures;
	const more = rest.length > 0 ? ` (+${rest.length} more)` : "";

	// A partial failure is deliberately worded so it can be presented as a
	// warning rather than a hard error: the call itself did useful work.
	if (failures.length < considered) {
		return `${failures.length} of ${considered} items failed: ${first}${more}`;
	}

	return considered === 1
		? first
		: `All ${considered} items failed: ${first}${more}`;
}

function describeFailure(record: Record<string, unknown>): string {
	const error = typeof record.error === "string" ? record.error.trim() : "";
	if (error) {
		return error;
	}
	const query = typeof record.query === "string" ? record.query.trim() : "";
	return query
		? `${query}: failed`
		: "Tool reported failure without an error message.";
}
