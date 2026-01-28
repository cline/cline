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

// Get provider order from providers.json (same order as webview)
const providerOrder: string[] = providersData.list.map((p: { value: string }) => p.value)

export function getProviderLabel(providerId: string): string {
	return providerLabels[providerId] || providerId
}

export function getProviderOrder(): string[] {
	return providerOrder
}

interface ProviderPickerProps {
	onSelect: (providerId: string) => void
	isActive?: boolean
}

export const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSelect, isActive = true }) => {
	// Use providers.json order, filtered to only available providers
	const items: SearchableListItem[] = useMemo(() => {
		const availableProviders = new Set(API_PROVIDERS_LIST)
		const sorted = providerOrder.filter((p) => availableProviders.has(p))

		return sorted.map((providerId) => ({
			id: providerId,
			label: getProviderLabel(providerId),
		}))
	}, [])

	return <SearchableList isActive={isActive} items={items} onSelect={(item) => onSelect(item.id)} />
}
