/** Keep useful startup messages, but omit records that may contain credentials. */
export function sanitizeStartupError(error: unknown): Error {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown session-service startup failure";
	// Inspect the entire message before truncating: a secret marker may be at the end.
	const sanitized =
		/token|secret|password|authorization|credential|api[_-]?key|bearer|:\/\/|private key|cookie|sk-|eyj/i.test(
			message,
		)
			? "Sensitive session-service startup diagnostic omitted"
			: message.replace(/\p{Cc}/gu, " ").slice(0, 2048);
	// Do not copy stack, cause, custom names, or enumerable fields from the raw error.
	return new Error(sanitized);
}
