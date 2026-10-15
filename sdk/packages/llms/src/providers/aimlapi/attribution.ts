import {
	AIMLAPI_DEFAULT_INTEGRATION_REPO,
	AIMLAPI_DEFAULT_INTEGRATION_VERSION,
	resolveAimlapiPartner,
} from "./config";

/**
 * The one host attribution may reach, compared for EQUALITY on the parsed
 * hostname. A suffix or substring test would hand the partner id to
 * `api.aimlapi.com.example.net` or `notapi.aimlapi.com`.
 */
export const AIMLAPI_ATTRIBUTION_HOST = "api.aimlapi.com";

/** Attribution sent with every aimlapi.com request Cline makes. */
export function aimlapiAttributionHeaders(): Record<string, string> {
	const partner = resolveAimlapiPartner();
	return {
		"X-AIMLAPI-Source": "agent/cline",
		...(partner.id ? { "X-AIMLAPI-Partner-ID": partner.id } : {}),
		"X-AIMLAPI-Integration-Repo": AIMLAPI_DEFAULT_INTEGRATION_REPO,
		"X-AIMLAPI-Integration-Version": AIMLAPI_DEFAULT_INTEGRATION_VERSION,
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
 * included. Here the headers are added only when the resolved request URL's
 * hostname is exactly `api.aimlapi.com`, and the wrap sits in the provider
 * factory, so it applies to whichever fetch the host supplied (a proxy-aware
 * fetch, a test double) rather than only to the default one.
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
