export interface ProviderErrorInfo {
	kind: "provider";
	providerId: string;
	modelId?: string;
	message: string;
	code?: string;
	status?: number;
	requestId?: string;
	details?: Record<string, unknown>;
}

export interface AuthErrorInfo {
	kind: "auth";
	providerId: string;
	message: string;
	code: string;
	details?: Record<string, unknown>;
}

export type AgentErrorInfo = ProviderErrorInfo | AuthErrorInfo;

export type ErrorWithInfo = Error & { errorInfo: AgentErrorInfo };

export const CLINE_INSUFFICIENT_CREDITS_CODE = "insufficient_credits";
export const CLINE_ACCOUNT_AUTH_REQUIRED_CODE = "cline_account_auth_required";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isProviderErrorInfo(
	value: unknown,
): value is ProviderErrorInfo {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.kind === "provider" &&
		typeof value.providerId === "string" &&
		typeof value.message === "string"
	);
}

export function isAuthErrorInfo(value: unknown): value is AuthErrorInfo {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.kind === "auth" &&
		typeof value.providerId === "string" &&
		typeof value.message === "string" &&
		typeof value.code === "string"
	);
}

export function isAgentErrorInfo(value: unknown): value is AgentErrorInfo {
	return isProviderErrorInfo(value) || isAuthErrorInfo(value);
}

export function isClineInsufficientCreditsErrorInfo(
	value: unknown,
): value is ProviderErrorInfo & {
	providerId: "cline";
	code: typeof CLINE_INSUFFICIENT_CREDITS_CODE;
} {
	return (
		isProviderErrorInfo(value) &&
		value.providerId === "cline" &&
		value.code === CLINE_INSUFFICIENT_CREDITS_CODE
	);
}

export function isClineAccountAuthRequiredErrorInfo(
	value: unknown,
): value is AuthErrorInfo & {
	providerId: "cline";
	code: typeof CLINE_ACCOUNT_AUTH_REQUIRED_CODE;
} {
	return (
		isAuthErrorInfo(value) &&
		value.providerId === "cline" &&
		value.code === CLINE_ACCOUNT_AUTH_REQUIRED_CODE
	);
}

export function getErrorInfo(error: unknown): AgentErrorInfo | undefined {
	if (!isRecord(error)) {
		return undefined;
	}
	return isAgentErrorInfo(error.errorInfo) ? error.errorInfo : undefined;
}

export function createErrorWithInfo(
	errorInfo: AgentErrorInfo,
	message = errorInfo.message,
): ErrorWithInfo {
	const error = new Error(message) as ErrorWithInfo;
	error.errorInfo = errorInfo;
	return error;
}

export function createClineAccountAuthRequiredError(
	message = "Cline account authentication requires sign in.",
): ErrorWithInfo {
	return createErrorWithInfo({
		kind: "auth",
		providerId: "cline",
		code: CLINE_ACCOUNT_AUTH_REQUIRED_CODE,
		message,
	});
}
