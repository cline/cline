const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
] as const;

/**
 * Hosts a proxy can never dial on the client's behalf: "127.0.0.1" on the
 * proxy machine is the proxy's own loopback, not the client's. `NO_PROXY`
 * matching in Bun (and curl) is literal per host, so "localhost" does not
 * cover "127.0.0.1" — every loopback spelling must be listed.
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
 * The union of both casings' exemptions plus the loopback hosts, first
 * spelling wins on duplicates. `NO_PROXY` and `no_proxy` can be populated
 * independently (by a launcher and a shell profile, say) and different tools
 * read different casings, so synchronizing both to one casing's value would
 * silently drop the other's exemptions and route previously exempt traffic
 * through the proxy. Undefined when either casing opts out of proxying
 * entirely with `*`.
 */
function mergeNoProxyValue(
	upper: string | undefined,
	lower: string | undefined,
): string | undefined {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const entry of [
		...splitNoProxyEntries(upper),
		...splitNoProxyEntries(lower),
		...LOOPBACK_NO_PROXY_HOSTS,
	]) {
		if (entry === "*") {
			return undefined;
		}
		const key = entry.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			merged.push(entry);
		}
	}
	return merged.join(",");
}

/**
 * Exempt loopback traffic from proxy environment variables.
 *
 * Bun's `fetch` honors `HTTP_PROXY`/`HTTPS_PROXY` (either case) with **no
 * built-in localhost bypass**: `fetch("http://127.0.0.1:<port>/health")` is
 * sent to the configured proxy, which cannot connect back into the client's
 * loopback. On machines where a system proxy exports those variables (Clash,
 * v2ray, corporate setups — especially common on Windows), every local hub
 * probe then fails while the hub itself is healthy: the desktop sidecar dies
 * with "No compatible hub runtime is available", respawned daemons exit with
 * "Hub instance lock is held by a live Hub", and local provider servers
 * (e.g. OpenCode on 127.0.0.1:4096) report `ConnectionRefused` although
 * netstat shows them LISTENING (cline/cline#14265, #14292, #14394).
 *
 * The only lever Bun exposes is `NO_PROXY` (a per-request `proxy` option does
 * not override the environment), so this appends the loopback spellings to
 * `NO_PROXY`/`no_proxy` whenever a proxy variable is set. Non-loopback
 * traffic keeps using the proxy, and an explicit `NO_PROXY=*` is left alone.
 * Idempotent; call at process startup. Spawned children inherit the bypass
 * through their environment.
 */
export function ensureLoopbackProxyBypass(
	env: Record<string, string | undefined> = process.env,
): void {
	if (!readProxyValue(env)) {
		return;
	}
	const merged = mergeNoProxyValue(env.NO_PROXY, env.no_proxy);
	if (merged === undefined) {
		return;
	}
	// Set both casings to the merged union: Bun and curl read either, and
	// consumers the agent spawns may only read one. Merging (rather than
	// copying one casing over the other) means no pre-existing exemption is
	// ever dropped — entries are only added.
	env.NO_PROXY = merged;
	env.no_proxy = merged;
}
