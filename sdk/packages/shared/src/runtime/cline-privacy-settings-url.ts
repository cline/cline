export type ClinePrivacySettingsClient =
	| "cli"
	| "desktop"
	| "jetbrains"
	| "vscode";

export function getClinePrivacySettingsUrl(
	dataPrivacyPath: string | undefined,
	appBaseUrl: string | undefined,
	client: ClinePrivacySettingsClient,
): string | undefined {
	if (!dataPrivacyPath || !appBaseUrl) {
		return undefined;
	}
	try {
		const url = new URL(dataPrivacyPath, appBaseUrl);
		if (url.origin !== new URL(appBaseUrl).origin) {
			return undefined;
		}
		url.searchParams.set("client", client);
		return url.href;
	} catch {
		return undefined;
	}
}
