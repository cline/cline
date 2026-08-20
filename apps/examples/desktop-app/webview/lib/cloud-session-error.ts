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

/**
 * The error envelope travels in Error.message and is authenticated by string
 * prefix only, so error strings a session pod controls can smuggle a spoofed
 * envelope through the sidecar. Legitimate connectUrls are always built from
 * the Cline app base URL; only honor those origins, or the "Connect GitHub"
 * action would open an attacker-chosen page in the user's browser.
 */
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
	const message = parseCloudSessionError(value)?.message ?? value;
	if (
		/session belongs to environment/i.test(message) &&
		(/\bundefined\b/i.test(message) || message.includes("[object Object]"))
	) {
		return "Cline couldn’t identify this cloud session’s environment. Open it from its dashboard link or retry where it was created.";
	}
	return message;
}

/** Adds handoff-specific reassurance for transport failures. */
export function humanizeCloudHandoffError(value: string): string {
	const message = humanizeCloudSessionError(value).trim();
	const normalized = message.toLowerCase();
	if (
		normalized === "fetch failed" ||
		normalized === "failed to fetch" ||
		normalized === "network request failed" ||
		normalized === "load failed"
	) {
		return "Couldn’t reach Cline Cloud. Your local conversation is still available.";
	}
	return message;
}
