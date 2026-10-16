export interface AimlapiEndpoints {
	authBaseUrl: string;
	appBaseUrl: string;
	payBaseUrl: string;
	inferenceBaseUrl: string;
	verificationBaseUrl: string;
}

const DEFAULT_ENDPOINTS: AimlapiEndpoints = {
	authBaseUrl: "https://auth.aimlapi.com",
	appBaseUrl: "https://app.aimlapi.com",
	payBaseUrl: "https://pay.aimlapi.com",
	inferenceBaseUrl: "https://api.aimlapi.com/v1",
	verificationBaseUrl: "https://app.aimlapi.com",
};

export const AIMLAPI_DEFAULT_MODEL = "anthropic/claude-sonnet-5";
// Minted by AI/ML API for Cline (2026-10-15). Partner ids are issued server-side
// as random tokens; an id the gateway did not issue is accepted and silently
// dropped, so a made-up value here would leave all traffic unattributed.
export const AIMLAPI_DEFAULT_PARTNER_ID = "part_HSyUEqWOLXYAn56CBHNOMBlj";
export const AIMLAPI_DEFAULT_PARTNER_NAME = "Cline";
export const AIMLAPI_DEFAULT_INTEGRATION_REPO = "cline/cline";
export const AIMLAPI_DEFAULT_INTEGRATION_VERSION = "cline";
export const AIMLAPI_MIN_AMOUNT_USD_MINOR = 2_000;
export const AIMLAPI_MAX_AMOUNT_USD_MINOR = 1_000_000;
export const AIMLAPI_DEFAULT_AMOUNT_USD_MINOR = 2_500;

function readEnv(name: string): string | undefined {
	if (typeof process === "undefined") return undefined;
	const value = process.env[name]?.trim();
	return value || undefined;
}

export function resolveAimlapiEndpoints(): AimlapiEndpoints {
	return {
		authBaseUrl: readEnv("AIMLAPI_AUTH_URL") ?? DEFAULT_ENDPOINTS.authBaseUrl,
		appBaseUrl: readEnv("AIMLAPI_APP_URL") ?? DEFAULT_ENDPOINTS.appBaseUrl,
		payBaseUrl: readEnv("AIMLAPI_PAY_URL") ?? DEFAULT_ENDPOINTS.payBaseUrl,
		inferenceBaseUrl:
			readEnv("AIMLAPI_INFERENCE_URL") ?? DEFAULT_ENDPOINTS.inferenceBaseUrl,
		verificationBaseUrl:
			readEnv("AIMLAPI_VERIFICATION_BASE_URL") ??
			DEFAULT_ENDPOINTS.verificationBaseUrl,
	};
}

export function resolveAimlapiPartner(): { id: string; name: string } {
	return {
		id: readEnv("AIMLAPI_PARTNER_ID") ?? AIMLAPI_DEFAULT_PARTNER_ID,
		name: readEnv("AIMLAPI_PARTNER_NAME") ?? AIMLAPI_DEFAULT_PARTNER_NAME,
	};
}

export function buildAimlapiCheckoutReturnUrls(
	payBaseUrl: string,
	sessionToken: string,
): { successUrl?: string; cancelUrl?: string } {
	const base = payBaseUrl.trim().replace(/\/+$/, "");
	if (!base) return {};
	const token = encodeURIComponent(sessionToken);
	const query = (status: string) =>
		`checkout=${status}&partnerCheckout=1&sessionToken=${token}`;
	return {
		successUrl: `${base}/checkout?${query("success")}`,
		cancelUrl: `${base}/checkout?${query("cancel")}`,
	};
}

export function buildAimlapiReturnUrl(frontendBaseUrl: string): string {
	return (
		readEnv("AIMLAPI_RETURN_URL") ||
		frontendBaseUrl.trim().replace(/\/+$/, "") ||
		DEFAULT_ENDPOINTS.verificationBaseUrl
	);
}
