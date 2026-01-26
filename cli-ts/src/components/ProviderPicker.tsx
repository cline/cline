/**
 * Provider picker component for API provider selection
 */

import React, { useMemo } from "react"
import { API_PROVIDERS_LIST } from "@/shared/api"
import providersData from "@/shared/providers/providers.json"
import { SearchableList, SearchableListItem } from "./SearchableList"

// Create a lookup map from provider value to display label
const providerLabels: Record<string, string> = Object.fromEntries(
	providersData.list.map((p: { value: string; label: string }) => [p.value, p.label]),
)

// Popular providers to show at the top of the list
export const POPULAR_PROVIDERS = ["anthropic", "openai-native", "openai", "gemini", "bedrock", "openrouter"]

export function getProviderLabel(providerId: string): string {
	return providerLabels[providerId] || providerId
}

interface ProviderPickerProps {
	onSelect: (providerId: string) => void
	isActive?: boolean
	configuredProviders?: Set<string>
}

export const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSelect, isActive = true, configuredProviders = new Set() }) => {
	// Sort providers with popular ones first, then alphabetically
	const items: SearchableListItem[] = useMemo(() => {
		const popular = POPULAR_PROVIDERS.filter((p) => API_PROVIDERS_LIST.includes(p))
		const others = API_PROVIDERS_LIST.filter((p) => !POPULAR_PROVIDERS.includes(p)).sort()
		const sorted = [...popular, ...others]

		return sorted.map((providerId) => ({
			id: providerId,
			label: getProviderLabel(providerId),
			suffix: configuredProviders.has(providerId) ? "(configured)" : undefined,
		}))
	}, [configuredProviders])

	return <SearchableList isActive={isActive} items={items} onSelect={(item) => onSelect(item.id)} />
}
