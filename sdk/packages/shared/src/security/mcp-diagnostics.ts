/**
 * Best-effort redaction for MCP errors and status text that may be persisted or
 * sent across a UI boundary. This is deliberately browser-safe so every MCP
 * client uses the same rules.
 */
export function sanitizeMcpDiagnosticText(message: string): string {
	return message
		.replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
			try {
				const url = new URL(rawUrl);
				const hadCredentials =
					url.username.length > 0 || url.password.length > 0;
				const hadSearch = url.search.length > 0;
				const hadHash = url.hash.length > 0;
				if (!hadCredentials && !hadSearch && !hadHash) {
					return rawUrl;
				}
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return `${url.toString()}${hadSearch ? "?[REDACTED]" : ""}${hadHash ? "#[REDACTED]" : ""}`;
			} catch {
				return "[REDACTED URL]";
			}
		})
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(/\bBasic\s+([A-Za-z0-9+/]+={0,2})/gi, (match, encoded) => {
			try {
				const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
				return globalThis.atob(padded).includes(":")
					? "Basic [REDACTED]"
					: match;
			} catch {
				return match;
			}
		})
		.replace(
			/\bAuthorization["']?\s*[:=]\s*(?:Bearer|Basic)?\s*[^\s,;}]+/gi,
			"Authorization: [REDACTED]",
		)
		.replace(/\b(Cookie|Set-Cookie)["']?\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]")
		.replace(
			/(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|auth[_-]?token|client[_-]?secret|code[_-]?verifier|authorization[_-]?code|oauth[_-]?state|api[_-]?key|password|passwd|secret|token|state|code)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
			"$1[REDACTED]",
		)
		.replace(
			/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/g,
			"[REDACTED JWT]",
		);
}
