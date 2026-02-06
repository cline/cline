import type { BannerAction, BannerCardData } from "@shared/cline/banner"
import { DynamicIcon } from "lucide-react/dynamic"
import type React from "react"
import type { BannerData } from "@/components/common/BannerCarousel"

/**
 * Convert BannerCardData to BannerData for rendering
 */
export function convertBannerData(
	banner: BannerCardData,
	handlers: {
		onAction: (action: BannerAction) => void
		onDismiss: (bannerId: string) => void
	},
): BannerData {
	const { onAction, onDismiss } = handlers

	// Filter and process actions
	const filteredActions =
		banner.actions?.map((action) => ({
			label: action.title,
			onClick: () => onAction(action),
		})) || []

	return {
		id: banner.id,
		icon: banner.icon ? (
			<DynamicIcon className="size-4" name={banner.icon as React.ComponentProps<typeof DynamicIcon>["name"]} />
		) : undefined,
		title: banner.title,
		description: banner.description,
		actions: filteredActions.length > 0 ? filteredActions : undefined,
		onDismiss: () => onDismiss(banner.id),
	}
}
