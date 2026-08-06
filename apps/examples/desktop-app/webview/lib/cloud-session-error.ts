const CLOUD_SESSION_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";

export type CloudSessionError = {
	code:
		| "github_not_connected"
		| "authentication_required"
		| "session_not_found"
		| "request_failed";
	message: string;
	connectUrl?: string;
};

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
			parsed.code !== "request_failed"
		) {
			return null;
		}
		return {
			code: parsed.code,
			message: parsed.message,
			connectUrl:
				typeof parsed.connectUrl === "string" && parsed.connectUrl.trim()
					? parsed.connectUrl.trim()
					: undefined,
		};
	} catch {
		return null;
	}
}
