/**
 * Featured model picker component
 * Shows curated models with labels (Best, New, Trending, FREE) and optional "Browse all" option
 * Used in both onboarding (AuthView) and settings (SettingsPanelContent)
 */

import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import type { FeaturedModel } from "../constants/featured-models"

interface FeaturedModelPickerProps {
	selectedIndex: number
	title?: string
	showBrowseAll?: boolean
	helpText?: string
	featuredModels: FeaturedModel[]
}

export const FeaturedModelPicker: React.FC<FeaturedModelPickerProps> = ({
	selectedIndex,
	title,
	showBrowseAll = true,
	helpText = "Arrows to navigate, Enter to select",
	featuredModels,
}) => {
	const models = featuredModels

	return (
		<Box flexDirection="column">
			{title && (
				<Text>
					<Text bold color={COLORS.primaryBlue}>
						{title}
					</Text>
					<Text> </Text>
				</Text>
			)}

			{models.map((model, i) => {
				const isSelected = i === selectedIndex

				return (
					<Box flexDirection="column" key={`${model.id}-${model.labels[0] || "default"}`} marginBottom={1}>
						<Box>
							<Text color={isSelected ? COLORS.primaryBlue : undefined}>{isSelected ? "❯ " : "  "}</Text>
							<Text bold color={isSelected ? COLORS.primaryBlue : "white"}>
								{model.name}
							</Text>
							{model.labels.map((label) => (
								<Text key={label}>
									<Text> </Text>
									<Text backgroundColor={label === "FREE" ? "gray" : COLORS.primaryBlue} color="black">
										{" "}
										{label}{" "}
									</Text>
								</Text>
							))}
						</Box>
						<Box paddingLeft={2}>
							<Text color="gray">{model.description}</Text>
						</Box>
					</Box>
				)
			})}

			{showBrowseAll && (
				<Box>
					<Text color={selectedIndex === models.length ? COLORS.primaryBlue : "white"}>
						{selectedIndex === models.length ? "❯ " : "  "}
						Browse all models...
					</Text>
				</Box>
			)}

			<Text> </Text>
			<Text color="gray">{helpText}</Text>
		</Box>
	)
}

/**
 * Get the maximum valid index for the featured model picker
 * (includes "Browse all" option if showBrowseAll is true)
 */
export function getFeaturedModelMaxIndex(featuredModels: FeaturedModel[], showBrowseAll = true): number {
	return showBrowseAll ? featuredModels.length : featuredModels.length - 1
}

/**
 * Check if the selected index is the "Browse all" option
 */
export function isBrowseAllSelected(selectedIndex: number, featuredModels: FeaturedModel[]): boolean {
	return selectedIndex === featuredModels.length
}

/**
 * Get the featured model at the given index, or null if "Browse all" is selected
 */
export function getFeaturedModelAtIndex(index: number, featuredModels: FeaturedModel[]): FeaturedModel | null {
	if (index >= 0 && index < featuredModels.length) {
		return featuredModels[index]
	}
	return null
}
