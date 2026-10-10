import { APICallError, RetryError } from "ai";

const REQUEST_ID_HEADER = "x-request-id";

export function extractResponseRequestId(error: unknown): string | undefined {
	if (RetryError.isInstance(error)) {
		return extractResponseRequestId(error.lastError);
	}
	if (!APICallError.isInstance(error)) {
		return undefined;
	}
	const value = Object.entries(error.responseHeaders ?? {}).find(
		([name]) => name.toLowerCase() === REQUEST_ID_HEADER,
	)?.[1];
	return value?.trim() || undefined;
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
