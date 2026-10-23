export const SESSION_NOT_FOUND_ERROR_CODE = "session_not_found";

export class SessionNotFoundError extends Error {
	readonly code = SESSION_NOT_FOUND_ERROR_CODE;

	constructor(
		readonly sessionId?: string,
		message?: string,
	) {
		super(
			message ??
				(sessionId ? `session not found: ${sessionId}` : "session not found"),
		);
		this.name = "SessionNotFoundError";
	}
}

export function isSessionNotFoundError(
	error: unknown,
): error is SessionNotFoundError {
	return (
		error instanceof SessionNotFoundError ||
		(typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === SESSION_NOT_FOUND_ERROR_CODE)
	);
}
