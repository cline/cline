const ENV_REFERENCE_PATTERN = /\$\{env:([^}]+)\}/g;

function expandEnvReference(value: string): string {
	return value.replace(ENV_REFERENCE_PATTERN, (match, name: string) => {
		const resolved = process.env[name.trim()];
		// An unset variable keeps its literal token so the misconfiguration
		// reaches the server verbatim instead of as a silent empty credential.
		return resolved === undefined ? match : resolved;
	});
}

export function expandMcpEnvRecord(
	env: Record<string, string>,
): Record<string, string> {
	const expanded: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		expanded[key] = expandEnvReference(value);
	}
	return expanded;
}
