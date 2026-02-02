/**
 * Provider Factory
 *
 * Auto-detects the provider being used and returns the appropriate adapter.
 * Detection is based on the API handler's constructor name.
 */

import { AnthropicAdapter } from "./anthropic"
import type { ProviderAdapter } from "./base"
import { BedrockAdapter } from "./bedrock"

/**
 * Gets the appropriate provider adapter for the given API handler
 *
 * @param api - The API handler instance from Cline's task
 * @returns The appropriate provider adapter
 */
export function getProviderAdapter(api: any): ProviderAdapter {
	// Detect provider from API handler class name
	const className = api?.constructor?.name || ""

	console.log(`[Provider Factory] Detected API handler: ${className}`)

	// Check for Bedrock
	if (className.includes("Bedrock") || className.includes("bedrock")) {
		console.log("[Provider Factory] ✓ Using Bedrock adapter (quirks isolated)")
		return new BedrockAdapter()
	}

	// Check for other provider names (if needed in future)
	if (className.includes("OpenAI") || className.includes("openai")) {
		console.log("[Provider Factory] ✓ Using Anthropic adapter (OpenAI compatible)")
		return new AnthropicAdapter()
	}

	// Default to Anthropic adapter (most compatible)
	console.log("[Provider Factory] ✓ Using Anthropic adapter (default)")
	return new AnthropicAdapter()
}

/**
 * Type guard to check if an object is a provider adapter
 */
export function isProviderAdapter(obj: any): obj is ProviderAdapter {
	return (
		obj &&
		typeof obj.name === "string" &&
		typeof obj.prepareMessages === "function" &&
		typeof obj.consumeStream === "function" &&
		typeof obj.buildAssistantMessage === "function" &&
		typeof obj.buildToolResultMessage === "function" &&
		typeof obj.isRecoverableError === "function" &&
		typeof obj.shouldRetry === "function"
	)
}
