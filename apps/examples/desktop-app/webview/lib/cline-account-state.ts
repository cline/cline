// Shared between the sidecar (which produces this result) and the webview
// (which consumes it), like the desktop transport types.

/**
 * Typed result the `cline_account` sidecar command returns when no Cline
 * account credentials exist. Being signed out is an expected state, so it
 * travels as a structured response instead of a thrown error: it must not be
 * reported to error telemetry or rendered as a raw error string.
 */
export const CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE =
	"ACCOUNT_NOT_AUTHENTICATED" as const;

export type ClineAccountNotAuthenticatedResult = {
	signedIn: false;
	code: typeof CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE;
};

export const CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT: ClineAccountNotAuthenticatedResult =
	{
		signedIn: false,
		code: CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE,
	};

export function isClineAccountNotAuthenticatedResult(
	value: unknown,
): value is ClineAccountNotAuthenticatedResult {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as ClineAccountNotAuthenticatedResult).code ===
			CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE &&
		(value as ClineAccountNotAuthenticatedResult).signedIn === false
	);
}
