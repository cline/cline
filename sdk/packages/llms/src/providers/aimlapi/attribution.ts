/**
 * aimlapi.com partner attribution for requests Cline sends to the gateway.
 *
 * The partner id is minted by aimlapi.com, which issues ids server-side as
 * random tokens. An id the gateway did not issue is accepted and silently
 * dropped, so a made-up value here would leave all traffic unattributed.
 * `AIMLAPI_PARTNER_ID` overrides it (for staging and testing).
 */
export const AIMLAPI_PARTNER_ID = "part_HSyUEqWOLXYAn56CBHNOMBlj";

/**
 * The one host attribution may reach, compared for EQUALITY on the parsed
 * hostname. A suffix or substring test would hand the partner id to
 * `api.aimlapi.com.example.net` or `notapi.aimlapi.com`.
 */
export const AIMLAPI_ATTRIBUTION_HOST = "api.aimlapi.com";

function readEnv(name: string): string | undefined {
	if (typeof process === "undefined") return undefined;
	const value = process.env[name]?.trim();
	return value || undefined;
}

/** Attribution sent with every aimlapi.com request Cline makes. */
export function aimlapiAttributionHeaders(): Record<string, string> {
	const partnerId = readEnv("AIMLAPI_PARTNER_ID") ?? AIMLAPI_PARTNER_ID;
	return {
		"X-AIMLAPI-Source": "agent/cline",
		...(partnerId ? { "X-AIMLAPI-Partner-ID": partnerId } : {}),
		"X-AIMLAPI-Integration-Repo": "cline/cline",
		"X-AIMLAPI-Integration-Version": "cline",
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
	};
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

/** Whether a request is bound for the aimlapi.com gateway itself. */
export function isAimlapiAttributionTarget(
	input: Parameters<typeof fetch>[0],
): boolean {
	try {
		return new URL(requestUrl(input)).hostname === AIMLAPI_ATTRIBUTION_HOST;
	} catch {
		return false;
	}
}

/**
 * Wrap the aimlapi provider's fetch so attribution follows the DESTINATION of
 * each request rather than the provider's configuration.
 *
 * Static `defaults.headers` would go to whatever `baseUrl` a user points the
 * provider at — a proxy, a staging host, someone else's gateway — partner id
 * included. Here the headers are added only when the request URL's hostname
 * is exactly `api.aimlapi.com`. The wrap sits in the provider factory rather
 * than in `defaults.fetch`: the registry resolves `config.fetch ??
 * defaults.fetch`, so a fetch supplied by the host would bypass a default and
 * drop attribution entirely. In the factory it wraps whichever fetch arrives.
 */
export function wrapFetchForAimlapiAttribution(
	baseFetch: typeof fetch | undefined,
	providerId: string,
): typeof fetch | undefined {
	if (providerId !== "aimlapi") {
		return baseFetch;
	}
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const attributedFetch = (async (input, init) => {
		if (!isAimlapiAttributionTarget(input)) {
			return delegate(input, init);
		}
		const headers = new Headers(
			input instanceof Request ? input.headers : undefined,
		);
		new Headers(init?.headers).forEach((value, key) => {
			headers.set(key, value);
		});
		for (const [key, value] of Object.entries(aimlapiAttributionHeaders())) {
			headers.set(key, value);
		}
		return delegate(input, { ...init, headers });
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(
			attributedFetch as typeof fetch & {
				preconnect?: (...args: unknown[]) => unknown;
			}
		).preconnect = delegateWithPreconnect.preconnect.bind(delegate);
	}
	return attributedFetch;
}
