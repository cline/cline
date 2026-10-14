/** Credential shapes that must never reach a provider. */
const SECRET_PATTERNS: readonly RegExp[] = [
	/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
	/\bghp_[A-Za-z0-9]{20,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	/\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
];

/** Patterns without capture groups pass the match offset where a group would be, hence the `typeof`. */
export function redactSecrets(text: string): string {
	return SECRET_PATTERNS.reduce(
		(out, pattern) =>
			out.replace(
				pattern,
				(_match: string, name: unknown, separator: unknown) =>
					typeof name === "string" && typeof separator === "string"
						? `${name}${separator}[redacted]`
						: "[redacted]",
			),
		text,
	);
}

/** One line of person-written text for the planner: secrets redacted, whitespace collapsed, at most `max` characters. */
export function clip(text: string, max: number): string {
	const line = redactSecrets(text).replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
