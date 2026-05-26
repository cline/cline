export const RUNTIME_SESSION_NOT_FOUND_ERROR_CODE = "session_not_found";

export class RuntimeSessionNotFoundError extends Error {
	readonly code = RUNTIME_SESSION_NOT_FOUND_ERROR_CODE;

	constructor(readonly sessionId: string) {
		super(`session not found: ${sessionId}`);
		this.name = "RuntimeSessionNotFoundError";
	}
}

export function isRuntimeSessionNotFoundError(
	error: unknown,
	sessionId?: string,
): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const record = error as { code?: unknown; sessionId?: unknown };
	if (record.code !== RUNTIME_SESSION_NOT_FOUND_ERROR_CODE) {
		return false;
	}
	return (
		!sessionId ||
		typeof record.sessionId !== "string" ||
		record.sessionId === sessionId
	);
}
