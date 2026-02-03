/**
 * Shared provider metadata utilities
 * Used by both UI components and CLI commands
 */

import providersData from "@/shared/providers/providers.json"

// Create a lookup map from provider value to display label
const providerLabels: Record<string, string> = Object.fromEntries(
	providersData.list.map((p: { value: string; label: string }) => [p.value, p.label]),
)

// Get provider order from providers.json (same order as webview)
const providerOrder: string[] = providersData.list.map((p: { value: string }) => p.value)

/**
 * Providers that are not supported in CLI.
 * - vscode-lm: Requires VS Code's Language Model API (see ENG-1490 for OAuth-based support)
 */
export const CLI_EXCLUDED_PROVIDERS = new Set<string>(["vscode-lm"])

/**
 * Get the display label for a provider ID
 */
export function getProviderLabel(providerId: string): string {
	return providerLabels[providerId] || providerId
}

/**
 * Get the ordered list of all provider IDs (from providers.json)
 */
export function getProviderOrder(): string[] {
	return providerOrder
}

/**
 * Get the list of valid CLI provider IDs (excluding unsupported providers)
 */
export function getValidCliProviders(): string[] {
	return providerOrder.filter((p) => !CLI_EXCLUDED_PROVIDERS.has(p))
}

/**
 * Check if a provider ID is valid for CLI use
 */
export function isValidCliProvider(providerId: string): boolean {
	return providerOrder.includes(providerId) && !CLI_EXCLUDED_PROVIDERS.has(providerId)
}
