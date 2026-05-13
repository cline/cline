export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "cline-sdk",
};

export const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_NIM_BILLING_ORIGIN_HEADER = "X-BILLING-INVOKE-ORIGIN";
export const NVIDIA_NIM_BILLING_ORIGIN_VALUE = "Cline";

function hasHeader(
	headers: Record<string, string> | undefined,
	headerName: string,
): boolean {
	const normalizedHeaderName = headerName.toLowerCase();
	return Object.keys(headers ?? {}).some(
		(key) => key.toLowerCase() === normalizedHeaderName,
	);
}

export function isPublicNvidiaNimBaseUrl(baseUrl: string | undefined): boolean {
	if (!baseUrl) return false;
	try {
		return (
			new URL(baseUrl.trim()).hostname.toLowerCase() ===
			"integrate.api.nvidia.com"
		);
	} catch {
		return false;
	}
}

export function addNvidiaBillingOriginHeader(
	headers?: Record<string, string>,
): Record<string, string> {
	if (hasHeader(headers, NVIDIA_NIM_BILLING_ORIGIN_HEADER)) {
		return { ...(headers ?? {}) };
	}
	return {
		...(headers ?? {}),
		[NVIDIA_NIM_BILLING_ORIGIN_HEADER]: NVIDIA_NIM_BILLING_ORIGIN_VALUE,
	};
}

export function addNvidiaBillingOriginHeaderForBaseUrl(
	baseUrl: string | undefined,
	headers?: Record<string, string>,
): Record<string, string> | undefined {
	if (!isPublicNvidiaNimBaseUrl(baseUrl)) {
		return headers;
	}
	return addNvidiaBillingOriginHeader(headers);
}

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
