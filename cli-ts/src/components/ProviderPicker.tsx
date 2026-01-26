/**
 * Reusable provider picker component
 * Shows a searchable list of API providers
 */

import { Box, Text, useInput } from "ink"
import React, { useEffect, useMemo, useState } from "react"
import { API_PROVIDERS_LIST } from "@/shared/api"
import providersData from "@/shared/providers/providers.json"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"

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

const TOTAL_ROWS = 8

export const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSelect, isActive = true, configuredProviders = new Set() }) => {
	const { isRawModeSupported } = useStdinContext()
	const [search, setSearch] = useState("")
	const [index, setIndex] = useState(0)

	// Sort providers with popular ones first, then alphabetically
	const sortedProviders = useMemo(() => {
		const popular = POPULAR_PROVIDERS.filter((p) => API_PROVIDERS_LIST.includes(p))
		const others = API_PROVIDERS_LIST.filter((p) => !POPULAR_PROVIDERS.includes(p)).sort()
		return [...popular, ...others]
	}, [])

	// Filter providers by search (searches both ID and display name)
	const filteredProviders = useMemo(() => {
		if (!search) return sortedProviders
		const searchLower = search.toLowerCase()
		return sortedProviders.filter(
			(p) => p.toLowerCase().includes(searchLower) || getProviderLabel(p).toLowerCase().includes(searchLower),
		)
	}, [sortedProviders, search])

	// Use shared scrollable list hook for windowing
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		filteredProviders.length,
		index,
		TOTAL_ROWS,
	)

	const visibleProviders = useMemo(() => {
		return filteredProviders.slice(visibleStart, visibleStart + visibleCount)
	}, [filteredProviders, visibleStart, visibleCount])

	// Reset index when search changes
	useEffect(() => {
		setIndex(0)
	}, [search])

	useInput(
		(input, key) => {
			if (key.upArrow) {
				setIndex((prev) => (prev > 0 ? prev - 1 : filteredProviders.length - 1))
			} else if (key.downArrow) {
				setIndex((prev) => (prev < filteredProviders.length - 1 ? prev + 1 : 0))
			} else if (key.return) {
				if (filteredProviders[index]) {
					onSelect(filteredProviders[index])
				}
			} else if (key.backspace || key.delete) {
				setSearch((prev) => prev.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta && !key.escape) {
				setSearch((prev) => prev + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">Search: </Text>
				<Text color="white">{search}</Text>
				<Text color="gray">▌</Text>
			</Box>
			<Text> </Text>
			{showTopIndicator && (
				<Text color="gray" dimColor>
					... {visibleStart} more above
				</Text>
			)}
			{visibleProviders.map((providerId, i) => {
				const actualIndex = visibleStart + i
				const label = getProviderLabel(providerId)
				const isConfigured = configuredProviders.has(providerId)
				return (
					<Box key={providerId}>
						<Text color={actualIndex === index ? "blueBright" : undefined}>
							{actualIndex === index ? "❯ " : "  "}
							{label}
							{isConfigured && <Text color="gray"> (configured)</Text>}
						</Text>
					</Box>
				)
			})}
			{showBottomIndicator && (
				<Text color="gray" dimColor>
					... {filteredProviders.length - visibleStart - visibleCount} more below
				</Text>
			)}
			{filteredProviders.length === 0 && (
				<Text color="gray" dimColor>
					No providers match "{search}"
				</Text>
			)}
		</Box>
	)
}
