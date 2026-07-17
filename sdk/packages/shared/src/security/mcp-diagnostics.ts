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
				const hadSearch = url.search.length > 0;
				const hadHash = url.hash.length > 0;
				if (!hadSearch && !hadHash) {
					return rawUrl;
				}
				url.search = "";
				url.hash = "";
				return `${url.toString()}${hadSearch ? "?[REDACTED]" : ""}${hadHash ? "#[REDACTED]" : ""}`;
			} catch {
				return "[REDACTED URL]";
			}
		})
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [REDACTED]")
		.replace(
			/\bAuthorization["']?\s*[:=]\s*(?:Bearer|Basic)?\s*[^\s,;}]+/gi,
			"Authorization: [REDACTED]",
		)
		.replace(
			/(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|code[_-]?verifier|api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
			"$1[REDACTED]",
		)
		.replace(
			/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/g,
			"[REDACTED JWT]",
		);
}
