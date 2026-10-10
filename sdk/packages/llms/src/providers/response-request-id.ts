const REQUEST_ID_HEADER = "x-request-id";

export function extractResponseRequestId(error: unknown): string | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}

	const candidate = error as {
		responseHeaders?: unknown;
		lastError?: unknown;
		errors?: unknown;
		cause?: unknown;
	};
	if (
		candidate.responseHeaders &&
		typeof candidate.responseHeaders === "object"
	) {
		const value = Object.entries(candidate.responseHeaders).find(
			([name]) => name.toLowerCase() === REQUEST_ID_HEADER,
		)?.[1];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return undefined;
}

export function appendRequestId(
	message: string,
	requestId: string | undefined,
): string {
	if (!requestId || message.includes(requestId)) {
		return message;
	}
	return `${message} (Request ID: ${requestId})`;
}
