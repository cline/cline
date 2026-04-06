/**
 * Custom Handler Registry
 *
 * Allows users to register their own custom handlers that extend BaseHandler.
 * This is useful for providers that require dependencies not included in this package
 * (e.g., VSCode LM handler that requires the vscode package).
 *
 * @example
 * ```typescript
 * import { registerHandler, BaseHandler, type ProviderConfig, type ApiStream, type Message } from "@clinebot/providers"
 * import * as vscode from "vscode"
 *
 * class VSCodeLmHandler extends BaseHandler {
 *   async *createMessage(systemPrompt: string, messages: Message[]): ApiStream {
 *     // Implementation using vscode.lm API
 *   }
 * }
 *
 * // Register the handler
 * registerHandler("vscode-lm", (config) => new VSCodeLmHandler(config))
 *
 * // Now createHandler will use your custom handler for "vscode-lm"
 * const handler = createHandler({ providerId: "vscode-lm", modelId: "copilot" })
 * ```
 */

import type {
	ApiHandler,
	HandlerFactory,
	LazyHandlerFactory,
	ProviderConfig,
} from "../types";

/**
 * Registry entry that can be either sync or async factory
 */
type RegistryEntry = {
	factory: HandlerFactory<ProviderConfig> | LazyHandlerFactory<ProviderConfig>;
	isAsync: boolean;
};

/**
 * Internal registry of custom handlers
 */
const customHandlerRegistry = new Map<string, RegistryEntry>();

/**
 * Register a custom handler factory for a provider ID
 *
 * Use this to add handlers for providers that require external dependencies
 * not bundled with this package, or to override built-in handlers.
 *
 * @param providerId - The provider ID to register (can be existing or new)
 * @param factory - Factory function that creates the handler
 *
 * @example
 * ```typescript
 * // Simple registration
 * registerHandler("my-provider", (config) => new MyHandler(config))
 *
 * // Override built-in handler
 * registerHandler("anthropic", (config) => new MyCustomAnthropicHandler(config))
 * ```
 */
export function registerHandler(
	providerId: string,
	factory: HandlerFactory<ProviderConfig>,
): void {
	customHandlerRegistry.set(providerId, { factory, isAsync: false });
}

/**
 * Register an async handler factory for lazy loading
 *
 * Use this when your handler has heavy dependencies that should be
 * loaded only when needed.
 *
 * @param providerId - The provider ID to register
 * @param factory - Async factory function that creates the handler
 *
 * @example
 * ```typescript
 * registerAsyncHandler("heavy-provider", async (config) => {
 *   const { HeavyHandler } = await import("./heavy-handler")
 *   return new HeavyHandler(config)
 * })
 * ```
 */
export function registerAsyncHandler(
	providerId: string,
	factory: LazyHandlerFactory<ProviderConfig>,
): void {
	customHandlerRegistry.set(providerId, { factory, isAsync: true });
}

/**
 * Check if a custom handler is registered for a provider ID
 *
 * @param providerId - The provider ID to check
 */
export function hasRegisteredHandler(providerId: string): boolean {
	return customHandlerRegistry.has(providerId);
}

/**
 * Get a registered handler (internal use)
 *
 * @param providerId - The provider ID to get
 * @param config - The config to pass to the factory
 * @returns The handler instance, or undefined if not registered
 */
export function getRegisteredHandler(
	providerId: string,
	config: ProviderConfig,
): ApiHandler | undefined {
	const entry = customHandlerRegistry.get(providerId);
	if (!entry) {
		return undefined;
	}

	if (entry.isAsync) {
		throw new Error(
			`Handler for "${providerId}" is registered as async. Use getRegisteredHandlerAsync() or createHandlerAsync() instead.`,
		);
	}

	return (entry.factory as HandlerFactory<ProviderConfig>)(config);
}

/**
 * Get a registered handler asynchronously (internal use)
 *
 * @param providerId - The provider ID to get
 * @param config - The config to pass to the factory
 * @returns The handler instance, or undefined if not registered
 */
export async function getRegisteredHandlerAsync(
	providerId: string,
	config: ProviderConfig,
): Promise<ApiHandler | undefined> {
	const entry = customHandlerRegistry.get(providerId);
	if (!entry) {
		return undefined;
	}

	if (entry.isAsync) {
		return (entry.factory as LazyHandlerFactory<ProviderConfig>)(config);
	}

	return (entry.factory as HandlerFactory<ProviderConfig>)(config);
}

/**
 * Check if a registered handler is async
 *
 * @param providerId - The provider ID to check
 */
export function isRegisteredHandlerAsync(providerId: string): boolean {
	const entry = customHandlerRegistry.get(providerId);
	return entry?.isAsync ?? false;
}
