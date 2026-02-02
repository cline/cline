/**
 * Featured model picker component
 * Shows curated models with labels (Best, New, Trending, FREE) and optional "Browse all" option
 * Used in both onboarding (AuthView) and settings (SettingsPanelContent)
 */

import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { type FeaturedModel, getAllFeaturedModels } from "../constants/featured-models"

interface FeaturedModelPickerProps {
	selectedIndex: number
	title?: string
	showBrowseAll?: boolean
	helpText?: string
}

export const FeaturedModelPicker: React.FC<FeaturedModelPickerProps> = ({
	selectedIndex,
	title,
	showBrowseAll = true,
	helpText = "Arrows to navigate, Enter to select",
}) => {
	const featuredModels = getAllFeaturedModels()

	return (
		<Box flexDirection="column">
			{title && (
				<>
					<Text bold color={COLORS.primaryBlue}>
						{title}
					</Text>
					<Text> </Text>
				</>
			)}

			{featuredModels.map((model, i) => {
				const isSelected = i === selectedIndex

				return (
					<Box flexDirection="column" key={model.id} marginBottom={1}>
						<Box>
							<Text color={isSelected ? COLORS.primaryBlue : undefined}>{isSelected ? "❯ " : "  "}</Text>
							<Text bold color={isSelected ? COLORS.primaryBlue : "white"}>
								{model.name}
							</Text>
							{model.label && (
								<>
									<Text> </Text>
									<Text backgroundColor={model.label === "FREE" ? "gray" : COLORS.primaryBlue} color="black">
										{" "}
										{model.label}{" "}
									</Text>
								</>
							)}
						</Box>
						<Box paddingLeft={2}>
							<Text color="gray">{model.description}</Text>
						</Box>
					</Box>
				)
			})}

			{showBrowseAll && (
				<Box>
					<Text color={selectedIndex === featuredModels.length ? COLORS.primaryBlue : "white"}>
						{selectedIndex === featuredModels.length ? "❯ " : "  "}
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
export function getFeaturedModelMaxIndex(showBrowseAll: boolean = true): number {
	const featuredModels = getAllFeaturedModels()
	return showBrowseAll ? featuredModels.length : featuredModels.length - 1
}

/**
 * Check if the selected index is the "Browse all" option
 */
export function isBrowseAllSelected(selectedIndex: number): boolean {
	const featuredModels = getAllFeaturedModels()
	return selectedIndex === featuredModels.length
}

/**
 * Get the featured model at the given index, or null if "Browse all" is selected
 */
export function getFeaturedModelAtIndex(index: number): FeaturedModel | null {
	const featuredModels = getAllFeaturedModels()
	if (index >= 0 && index < featuredModels.length) {
		return featuredModels[index]
	}
	return null
}
