import sensitiveMarkers from "../shared/startup-diagnostic-markers.json";

/** Keep useful startup messages, but omit records that may contain credentials. */
export function sanitizeStartupError(error: unknown): Error {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown session-service startup failure";
	// Inspect the entire message before truncating: a secret marker may be at the end.
	const lower = message.toLowerCase();
	const sanitized = sensitiveMarkers.some((marker) => lower.includes(marker))
		? "Sensitive session-service startup diagnostic omitted"
		: message.replace(/\p{Cc}/gu, " ").slice(0, 2048);
	// Do not copy stack, cause, custom names, or enumerable fields from the raw error.
	return new Error(sanitized);
}
