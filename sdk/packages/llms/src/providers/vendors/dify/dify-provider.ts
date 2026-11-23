/*!
 * Vendored from dify-ai-provider v1.1.1 (https://github.com/warmwind/dify-ai-provider,
 * commit 352943be697b89cf1a4d329e11b53c1f19e4286d), (c) 2024 Oscar Jiang, MIT
 * license (see ./LICENSE). Changes for @ai-sdk/provider-utils 5 and zod 4 are
 * listed in ./README.md.
 */
import { type FetchFunction, loadApiKey } from "@ai-sdk/provider-utils";
import { DifyChatLanguageModel } from "./dify-chat-language-model";
import type {
	DifyChatModelId,
	DifyChatSettings,
	Logger,
} from "./dify-chat-settings";

// model factory function with additional methods and properties
export interface DifyProvider {
	(
		modelId: DifyChatModelId,
		settings?: DifyChatSettings,
	): DifyChatLanguageModel;

	// explicit method for targeting the chat API
	chat(
		modelId: DifyChatModelId,
		settings?: DifyChatSettings,
	): DifyChatLanguageModel;
}

// optional settings for the provider
export interface DifyProviderSettings {
	/**
	 * Use a different URL prefix for API calls, e.g. to use self-hosted Dify instance.
	 */
	baseURL?: string;

	/**
	 * Custom headers to include in the requests.
	 */
	headers?: Record<string, string>;
	/**
	 * Custom fetch implementation. You can use it as a middleware to intercept requests,
	 * or to provide a custom fetch implementation for e.g. testing.
	 */
	fetch?: FetchFunction;

	/**
	 * Logger instance for debugging. Set to `false` to disable logging.
	 */
	logger?: Logger | false;
}

export function createDifyProvider(
	options: DifyProviderSettings = {},
): DifyProvider {
	const createChatModel = (
		modelId: DifyChatModelId,
		settings: DifyChatSettings = {},
	) =>
		new DifyChatLanguageModel(modelId, settings, {
			provider: "dify.chat",
			baseURL: options.baseURL || "https://api.dify.ai/v1",
			headers: () => ({
				Authorization: `Bearer ${loadApiKey({
					apiKey: settings.apiKey,
					environmentVariableName: "DIFY_API_KEY",
					description: "Dify API Key",
				})}`,
				"Content-Type": "application/json",
				...options.headers,
			}),
			// Upstream declares `fetch` but never forwarded it, so a caller-supplied
			// fetch (proxy, sticky-session wrapper, test stub) was ignored.
			fetch: options.fetch,
		});

	const provider = function (
		modelId: DifyChatModelId,
		settings?: DifyChatSettings,
	) {
		if (new.target) {
			throw new Error(
				"The model factory function cannot be called with the new keyword.",
			);
		}

		return createChatModel(modelId, settings);
	};

	provider.chat = createChatModel;

	return provider;
}

/**
 * Default Dify provider instance.
 */
export const difyProvider = createDifyProvider();
