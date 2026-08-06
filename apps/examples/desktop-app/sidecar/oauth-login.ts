import { randomUUID } from "node:crypto";
import type { OAuthPrompt, ProviderSettingsManager } from "@cline/core";
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

export type OAuthLoginBroadcast = (name: string, payload: unknown) => void;

/**
 * How long a manual-entry prompt stays open before falling back to the
 * prompt's default value (today's stubbed behavior). Generous because the
 * user is mid-browser-round-trip and may need to hunt for the code.
 */
const OAUTH_PROMPT_TIMEOUT_MS = 5 * 60_000;

type PendingOAuthPrompt = {
	providerId: string;
	settle: (value: string) => void;
	broadcast: OAuthLoginBroadcast;
};

const pendingOAuthPromptsById = new Map<string, PendingOAuthPrompt>();

/**
 * Forwards an OAuth manual-input prompt (e.g. "paste the authorization
 * code") to the UI over the transport and waits for `respond_oauth_prompt`.
 * Times out to the prompt's default value so a headless client degrades to
 * the previous stubbed behavior instead of hanging the login forever.
 */
function requestOAuthPromptOverTransport(
	providerId: string,
	prompt: OAuthPrompt,
	broadcast: OAuthLoginBroadcast,
): Promise<string> {
	return new Promise<string>((resolve) => {
		const promptId = randomUUID();
		const timeoutId = setTimeout(() => {
			if (pendingOAuthPromptsById.delete(promptId)) {
				broadcast("oauth_prompt_cancelled", {
					promptId,
					provider: providerId,
					reason: "timeout",
				});
				resolve(prompt.defaultValue ?? "");
			}
		}, OAUTH_PROMPT_TIMEOUT_MS);
		pendingOAuthPromptsById.set(promptId, {
			providerId,
			broadcast,
			settle: (value) => {
				clearTimeout(timeoutId);
				pendingOAuthPromptsById.delete(promptId);
				resolve(value);
			},
		});
		broadcast("oauth_prompt_requested", {
			promptId,
			provider: providerId,
			message: prompt.message,
			...(prompt.defaultValue !== undefined
				? { defaultValue: prompt.defaultValue }
				: {}),
		});
	});
}

/** Resolves a pending manual-entry prompt with the user's input. */
export function respondOAuthPrompt(promptId: string, value: string): boolean {
	const pending = pendingOAuthPromptsById.get(promptId);
	if (!pending) {
		return false;
	}
	pending.settle(value);
	return true;
}

function cancelOAuthPromptsForProvider(
	providerId: string,
	reason: string,
): void {
	for (const [promptId, pending] of pendingOAuthPromptsById) {
		if (pending.providerId !== providerId) {
			continue;
		}
		pending.broadcast("oauth_prompt_cancelled", {
			promptId,
			provider: providerId,
			reason,
		});
		pending.settle("");
	}
}

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
	options: { owner?: object; broadcast?: OAuthLoginBroadcast } = {},
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
			cancelOAuthPromptsForProvider(providerId, "login_cancelled");
			rejectOnCancel(new OAuthLoginCancelledError(providerId));
		},
		owner: options.owner,
	};
	pendingOAuthLoginsByProvider.set(providerId, entry);

	const broadcast = options.broadcast;
	// With a broadcast channel the login becomes interactive: progress lines
	// (verification URLs, device-auth user codes) reach the UI, and manual
	// code entry prompts round-trip instead of silently answering "".
	const overrides = broadcast
		? {
				onOutput: (message: string) =>
					broadcast("oauth_login_output", { provider: providerId, message }),
				onPrompt: (prompt: OAuthPrompt) =>
					requestOAuthPromptOverTransport(providerId, prompt, broadcast),
			}
		: undefined;

	try {
		// Promise.race subscribes to the login promise, so a late rejection
		// after cancellation is observed and cannot become an unhandled
		// rejection that kills the sidecar.
		const credentials = await Promise.race([
			dependencies.login(providerId, existing, openUrl, undefined, overrides),
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
		// The login settled (or was cancelled); any prompt still open can
		// never be consumed, so close it in the UI.
		cancelOAuthPromptsForProvider(providerId, "login_settled");
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
