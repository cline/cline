import type { ClientName } from "../extensions/context";

/**
 * Resolves a path into the Cline web app and attributes the client that
 * opened it. `path` can come from the server (`ClineAccountUser
 * .dataPrivacyPath`), so it is rejected when it resolves outside `appBaseUrl`.
 *
 * `client` is added after resolution because `new URL(path, base)` drops the
 * base's own query string as soon as a path is supplied: appending to the base
 * first would silently lose the attribution.
 */
export function getClineDashboardUrl(
	path: string | undefined,
	appBaseUrl: string | undefined,
	client: ClientName,
): string | undefined {
	if (!path || !appBaseUrl) {
		return undefined;
	}
	try {
		const url = new URL(path, appBaseUrl);
		if (url.origin !== new URL(appBaseUrl).origin) {
			return undefined;
		}
		url.searchParams.set("client", client);
		return url.href;
	} catch {
		return undefined;
	}
}
