import type { OAuthLoginCallbacks, OAuthPrompt } from "./types";

export interface OAuthClientCallbacksOptions {
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onOutput?: (message: string) => void;
	openUrl?: (url: string) => void | Promise<void>;
	onOpenUrlError?: (context: { url: string; error: unknown }) => void;
}

export function createOAuthClientCallbacks(
	options: OAuthClientCallbacksOptions,
): OAuthLoginCallbacks {
	return {
		onAuth: ({ url, instructions }) => {
			options.onOutput?.(instructions ?? "Complete sign-in in your browser.");
			if (options.openUrl) {
				void Promise.resolve(options.openUrl(url)).catch((error) => {
					options.onOpenUrlError?.({ url, error });
				});
			}
			options.onOutput?.(url);
		},
		onPrompt: options.onPrompt,
	};
}
