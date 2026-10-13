import { CLINE_ENVIRONMENTS } from "@cline/shared/browser";

const CLOUD_SESSION_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";

export type CloudSessionError = {
	code:
		| "github_not_connected"
		| "authentication_required"
		| "session_not_found"
		| "session_expired"
		| "session_failed"
		| "request_failed";
	message: string;
	connectUrl?: string;
};

/** Trust only Cline app origins from pod-controlled error envelopes. */
function trustedConnectUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) {
		return undefined;
	}
	const trimmed = value.trim();
	try {
		const origin = new URL(trimmed).origin;
		return Object.values(CLINE_ENVIRONMENTS).some(
			(environment) => new URL(environment.appBaseUrl).origin === origin,
		)
			? trimmed
			: undefined;
	} catch {
		return undefined;
	}
}

export function parseCloudSessionError(
	value: string | null | undefined,
): CloudSessionError | null {
	if (!value?.startsWith(CLOUD_SESSION_ERROR_PREFIX)) return null;
	try {
		const parsed = JSON.parse(
			value.slice(CLOUD_SESSION_ERROR_PREFIX.length),
		) as Partial<CloudSessionError>;
		if (typeof parsed.code !== "string" || typeof parsed.message !== "string") {
			return null;
		}
		if (
			parsed.code !== "github_not_connected" &&
			parsed.code !== "authentication_required" &&
			parsed.code !== "session_not_found" &&
			parsed.code !== "session_expired" &&
			parsed.code !== "session_failed" &&
			parsed.code !== "request_failed"
		) {
			return null;
		}
		return {
			code: parsed.code,
			message: parsed.message,
			connectUrl: trustedConnectUrl(parsed.connectUrl),
		};
	} catch {
		return null;
	}
}

/** Strips the machine-readable cloud error envelope for display. */
export function humanizeCloudSessionError(value: string): string {
	return parseCloudSessionError(value)?.message ?? value;
}
