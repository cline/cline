import { APICallError, RetryError } from "ai";

const REQUEST_ID_HEADER = "x-request-id";
const MAX_CAUSE_DEPTH = 5;

export function findRequestIdHeader(
	headers: Record<string, string | undefined> | undefined,
): string | undefined {
	const value = Object.entries(headers ?? {}).find(
		([name]) => name.toLowerCase() === REQUEST_ID_HEADER,
	)?.[1];
	return value?.trim() || undefined;
}

export function extractResponseRequestId(
	error: unknown,
	depth = 0,
): string | undefined {
	if (depth > MAX_CAUSE_DEPTH || !error || typeof error !== "object") {
		return undefined;
	}
	if (RetryError.isInstance(error)) {
		const fromLast = extractResponseRequestId(error.lastError, depth + 1);
		if (fromLast) {
			return fromLast;
		}
		for (let i = error.errors.length - 1; i >= 0; i--) {
			const attempt = error.errors[i];
			if (attempt === error.lastError) {
				continue;
			}
			const fromAttempt = extractResponseRequestId(attempt, depth + 1);
			if (fromAttempt) {
				return fromAttempt;
			}
		}
	}
	if (APICallError.isInstance(error)) {
		const fromHeaders = findRequestIdHeader(error.responseHeaders);
		if (fromHeaders) {
			return fromHeaders;
		}
	}
	return extractResponseRequestId(
		(error as { cause?: unknown }).cause,
		depth + 1,
	);
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
