import type { ProviderSettingsManager } from "@cline/core";
import {
	getProviderAuthStorageId,
	loginLocalProvider,
	markLocalProviderEnabled,
	saveLocalProviderOAuthCredentials,
} from "@cline/core";

export class OAuthLoginCancelledError extends Error {
	constructor(providerId: string) {
		super(`Sign-in was cancelled for provider "${providerId}"`);
		this.name = "OAuthLoginCancelledError";
	}
}

type PendingOAuthLogin = {
	cancelled: boolean;
	cancel: () => void;
	/** Transport connection that initiated the login, when known. */
	owner?: object;
};

// One pending browser round-trip per provider. Starting a new login for the
// same provider cancels the previous dangling attempt so an abandoned browser
// tab can never race a fresh sign-in.
const pendingOAuthLoginsByProvider = new Map<string, PendingOAuthLogin>();

export type OAuthLoginDependencies = {
	login: typeof loginLocalProvider;
	save: typeof saveLocalProviderOAuthCredentials;
	markEnabled: typeof markLocalProviderEnabled;
};

const defaultDependencies: OAuthLoginDependencies = {
	login: loginLocalProvider,
	save: saveLocalProviderOAuthCredentials,
	markEnabled: markLocalProviderEnabled,
};

/**
 * Runs a provider OAuth login that can be cancelled while the browser
 * round-trip is pending. Cancellation rejects the returned promise right away
 * AND guarantees the credentials of a late-completing browser flow are never
 * persisted, so the UI's signed-out state cannot diverge from disk.
 */
export async function runCancellableProviderOAuthLogin(
	manager: ProviderSettingsManager,
	providerId: string,
	openUrl: (url: string) => void,
	options: { owner?: object } = {},
	dependencies: OAuthLoginDependencies = defaultDependencies,
): Promise<{ provider: string; accessToken: string }> {
	const storageProviderId = getProviderAuthStorageId(providerId) ?? providerId;
	const existing = manager.getProviderSettings(storageProviderId);

	pendingOAuthLoginsByProvider.get(providerId)?.cancel();

	let rejectOnCancel: (error: Error) => void = () => undefined;
	const cancellation = new Promise<never>((_, reject) => {
		rejectOnCancel = reject;
	});
	const entry: PendingOAuthLogin = {
		cancelled: false,
		cancel: () => {
			entry.cancelled = true;
			rejectOnCancel(new OAuthLoginCancelledError(providerId));
		},
		owner: options.owner,
	};
	pendingOAuthLoginsByProvider.set(providerId, entry);

	try {
		// Promise.race subscribes to the login promise, so a late rejection
		// after cancellation is observed and cannot become an unhandled
		// rejection that kills the sidecar.
		const credentials = await Promise.race([
			dependencies.login(providerId, existing, openUrl),
			cancellation,
		]);
		if (entry.cancelled) {
			throw new OAuthLoginCancelledError(providerId);
		}
		const saved = dependencies.save(manager, providerId, existing, credentials);
		if (saved.provider !== providerId) {
			dependencies.markEnabled(manager, providerId, { tokenSource: "oauth" });
		}
		return {
			provider: providerId,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	} finally {
		if (pendingOAuthLoginsByProvider.get(providerId) === entry) {
			pendingOAuthLoginsByProvider.delete(providerId);
		}
	}
}

/**
 * Cancels the pending OAuth login for a provider, if any. Returns whether a
 * pending login existed. The cancelled attempt's credentials are discarded
 * even if the user later completes the already-open browser flow.
 */
export function cancelProviderOAuthLogin(providerId: string): boolean {
	const entry = pendingOAuthLoginsByProvider.get(providerId);
	if (!entry) {
		return false;
	}
	entry.cancel();
	pendingOAuthLoginsByProvider.delete(providerId);
	return true;
}

/**
 * Cancels every pending OAuth login initiated by a transport connection.
 * Called when that connection closes so a lost or undeliverable cancel
 * command (e.g. the webview reloaded or the transport dropped) can never
 * leave an abandoned browser flow that persists credentials later.
 */
export function cancelProviderOAuthLoginsForOwner(owner: object): number {
	let cancelled = 0;
	for (const [providerId, entry] of pendingOAuthLoginsByProvider) {
		if (entry.owner === owner) {
			entry.cancel();
			pendingOAuthLoginsByProvider.delete(providerId);
			cancelled += 1;
		}
	}
	return cancelled;
}
