import type { OAuthServerCloseInfo, OAuthServerListeningInfo } from "./server";
import type { OAuthLoginCallbacks, OAuthPrompt } from "./types";

export interface OAuthClientCallbacksOptions {
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onOutput?: (message: string) => void;
	openUrl?: (url: string) => void | Promise<void>;
	onOpenUrlError?: (context: { url: string; error: unknown }) => void;
	/**
	 * Called when the local OAuth redirect server successfully binds to a port
	 * and is ready to receive the browser callback.
	 *
	 * Forwarded directly from `OAuthLoginCallbacks.onServerListening`.
	 * Use this to show a "waiting for OAuth callback on :::1 port N" status
	 * message or, in remote-development environments (e.g. JetBrains Gateway),
	 * to set up a port-forward from the remote machine to the local one.
	 */
	onServerListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
	/**
	 * Called when the local OAuth redirect server closes.
	 *
	 * Forwarded directly from `OAuthLoginCallbacks.onServerClose`.
	 * Use this to tear down port-forwards and clear any status UI set up in
	 * `onServerListening`.
	 */
	onServerClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
}

export function createOAuthClientCallbacks(
	options: OAuthClientCallbacksOptions,
): OAuthLoginCallbacks {
	return {
		onAuth: ({ url, instructions }) => {
			options.onOutput?.(instructions ?? "Complete sign-in in your browser.");
			if (options.openUrl) {
				try {
					void Promise.resolve(options.openUrl(url)).catch((error) => {
						options.onOpenUrlError?.({ url, error });
					});
				} catch (error) {
					options.onOpenUrlError?.({ url, error });
				}
			}
			options.onOutput?.(url);
		},
		onPrompt: options.onPrompt,
		onServerListening: options.onServerListening,
		onServerClose: options.onServerClose,
	};
}
