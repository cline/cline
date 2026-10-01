const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
] as const;

/**
 * `NO_PROXY` matching in Bun (and curl) is literal per host, so every loopback
 * spelling must be listed.
 */
export const LOOPBACK_NO_PROXY_HOSTS = [
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
] as const;

function readProxyValue(
	env: Record<string, string | undefined>,
): string | undefined {
	for (const key of PROXY_ENV_KEYS) {
		const value = env[key]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

function splitNoProxyEntries(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/**
 * The union of both casings' exemptions plus the loopback hosts; first
 * spelling wins on duplicates. A `*` entry is dropped here and handled by the
 * caller, since it already exempts everything for whichever casing holds it.
 */
function mergeNoProxyValue(
	upper: string | undefined,
	lower: string | undefined,
): string {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const entry of [
		...splitNoProxyEntries(upper),
		...splitNoProxyEntries(lower),
		...LOOPBACK_NO_PROXY_HOSTS,
	]) {
		const key = entry.toLowerCase();
		if (key !== "*" && !seen.has(key)) {
			seen.add(key);
			merged.push(entry);
		}
	}
	return merged.join(",");
}

function hasWildcard(value: string | undefined): boolean {
	return splitNoProxyEntries(value).includes("*");
}

/**
 * Exempt loopback traffic from proxy environment variables.
 *
 * Bun's `fetch` honors `HTTP_PROXY`/`HTTPS_PROXY` with no built-in localhost
 * bypass, and a per-request `proxy` option does not override the environment,
 * so a system proxy (Clash, v2ray, corporate setups) swallows every local hub
 * probe and a healthy hub looks unreachable (cline/cline#14265, #14292).
 * `NO_PROXY` is the only lever: append the loopback spellings whenever a proxy
 * variable is set. Idempotent; spawned children inherit it.
 */
export function ensureLoopbackProxyBypass(
	env: Record<string, string | undefined> = process.env,
): void {
	if (!readProxyValue(env)) {
		return;
	}
	const upperAll = hasWildcard(env.NO_PROXY);
	const lowerAll = hasWildcard(env.no_proxy);
	if (upperAll && lowerAll) {
		return;
	}
	const merged = mergeNoProxyValue(env.NO_PROXY, env.no_proxy);
	// Both casings: Bun and curl read either, spawned tools may read only one.
	// A casing that already says `*` is left alone.
	if (!upperAll) {
		env.NO_PROXY = merged;
	}
	if (!lowerAll) {
		env.no_proxy = merged;
	}
}
