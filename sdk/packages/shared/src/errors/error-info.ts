export interface SdkProviderErrorInfo {
	kind: "provider";
	providerId: string;
	modelId?: string;
	message: string;
	code?: string;
	status?: number;
	requestId?: string;
	details?: Record<string, unknown>;
}

export interface SdkAuthErrorInfo {
	kind: "auth";
	providerId: string;
	message: string;
	code: string;
	details?: Record<string, unknown>;
}

export type SdkErrorInfo = SdkProviderErrorInfo | SdkAuthErrorInfo;

export type ErrorWithSdkInfo = Error & { errorInfo: SdkErrorInfo };

export const CLINE_INSUFFICIENT_CREDITS_CODE = "insufficient_credits";
export const CLINE_ACCOUNT_AUTH_REQUIRED_CODE = "cline_account_auth_required";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isSdkProviderErrorInfo(
	value: unknown,
): value is SdkProviderErrorInfo {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.kind === "provider" &&
		typeof value.providerId === "string" &&
		typeof value.message === "string"
	);
}

export function isSdkAuthErrorInfo(value: unknown): value is SdkAuthErrorInfo {
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

export function isSdkErrorInfo(value: unknown): value is SdkErrorInfo {
	return isSdkProviderErrorInfo(value) || isSdkAuthErrorInfo(value);
}

export function isClineInsufficientCreditsErrorInfo(
	value: unknown,
): value is SdkProviderErrorInfo & {
	providerId: "cline";
	code: typeof CLINE_INSUFFICIENT_CREDITS_CODE;
} {
	return (
		isSdkProviderErrorInfo(value) &&
		value.providerId === "cline" &&
		value.code === CLINE_INSUFFICIENT_CREDITS_CODE
	);
}

export function isClineAccountAuthRequiredErrorInfo(
	value: unknown,
): value is SdkAuthErrorInfo & {
	providerId: "cline";
	code: typeof CLINE_ACCOUNT_AUTH_REQUIRED_CODE;
} {
	return (
		isSdkAuthErrorInfo(value) &&
		value.providerId === "cline" &&
		value.code === CLINE_ACCOUNT_AUTH_REQUIRED_CODE
	);
}

export function getSdkErrorInfo(error: unknown): SdkErrorInfo | undefined {
	if (!isRecord(error)) {
		return undefined;
	}
	return isSdkErrorInfo(error.errorInfo) ? error.errorInfo : undefined;
}

export function createErrorWithSdkInfo(
	errorInfo: SdkErrorInfo,
	message = errorInfo.message,
): ErrorWithSdkInfo {
	const error = new Error(message) as ErrorWithSdkInfo;
	error.errorInfo = errorInfo;
	return error;
}

export function createClineAccountAuthRequiredError(
	message = "Cline account authentication requires sign in.",
): ErrorWithSdkInfo {
	return createErrorWithSdkInfo({
		kind: "auth",
		providerId: "cline",
		code: CLINE_ACCOUNT_AUTH_REQUIRED_CODE,
		message,
	});
}
