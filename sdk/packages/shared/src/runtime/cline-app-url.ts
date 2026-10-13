export function resolveClineAppUrl(
	path: string | undefined,
	appBaseUrl: string,
): URL | undefined {
	if (!path) {
		return undefined;
	}
	try {
		const appOrigin = new URL(appBaseUrl).origin;
		const url = new URL(path, appBaseUrl);
		return url.origin === appOrigin ? url : undefined;
	} catch {
		return undefined;
	}
}
