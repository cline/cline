/**
 * Shared provider metadata utilities
 * Used by both UI components and CLI commands
 */

import { useMemo } from "react"
import { StateManager } from "@/core/storage/StateManager"
import providersData from "@/shared/providers/providers.json"
import type { RemoteConfigFields } from "@/shared/storage/state-keys"

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
const CLI_EXCLUDED_PROVIDERS = new Set<string>(["vscode-lm"])

/**
 * Get the display label for a provider ID
 */
export function getProviderLabel(providerId: string): string {
	return providerLabels[providerId] || providerId
}

/**
 * Get the ordered list of all provider IDs (from providers.json)
 */
function getProviderOrder(): string[] {
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

const getValidProviders = (remoteConfig: Partial<RemoteConfigFields> | undefined) => {
	if (remoteConfig?.remoteConfiguredProviders?.length) {
		return remoteConfig.remoteConfiguredProviders
	}

	return getProviderOrder().filter((p: string) => !CLI_EXCLUDED_PROVIDERS.has(p))
}

export const useValidProviders = () => {
	const remoteConfig = StateManager.get().getRemoteConfigSettings()

	return useMemo(() => {
		return getValidProviders(remoteConfig)
	}, [remoteConfig])
}
