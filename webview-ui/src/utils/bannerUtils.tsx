import { BannerAction, BannerActionType, BannerCardData, BannerSeverity } from "@shared/cline/banner"
import { DynamicIcon } from "lucide-react/dynamic"
import React from "react"
import { BannerData } from "@/components/common/BannerCarousel"

/**
 * Filter banners based on platform, user auth state, and time window
 */
export function filterBanners(
	banners: BannerCardData[],
	options: {
		currentPlatform: "windows" | "mac" | "linux"
		isClineUser: boolean
		currentTime?: Date
	},
): BannerCardData[] {
	const { currentPlatform, isClineUser, currentTime = new Date() } = options

	return banners.filter((banner) => {
		// Platform filter
		if (banner.platforms && banner.platforms.length > 0) {
			if (currentPlatform && !banner.platforms.includes(currentPlatform)) {
				return false
			}
		}

		// User auth filter
		if (banner.clineUserOnly !== undefined) {
			if (banner.clineUserOnly && !isClineUser) {
				return false
			}
			if (!banner.clineUserOnly && isClineUser) {
				return false
			}
		}

		// Time window filter
		if (banner.active) {
			if (banner.active.from) {
				const fromDate = new Date(banner.active.from)
				if (currentTime < fromDate) {
					return false
				}
			}
			if (banner.active.to) {
				const toDate = new Date(banner.active.to)
				if (currentTime > toDate) {
					return false
				}
			}
		}

		return true
	})
}

/**
 * Filter actions based on platform and user auth state
 */
function filterActions(
	actions: BannerAction[] | undefined,
	options: {
		currentPlatform: "windows" | "mac" | "linux"
		isClineUser: boolean
	},
): BannerAction[] {
	if (!actions) {
		return []
	}

	const { currentPlatform, isClineUser } = options

	return actions.filter((action) => {
		// Platform filter
		if (action.platforms && action.platforms.length > 0) {
			if (!action.platforms.includes(currentPlatform)) {
				return false
			}
		}

		// User auth filter
		if (action.clineUserOnly !== undefined) {
			if (action.clineUserOnly && !isClineUser) {
				return false
			}
			if (!action.clineUserOnly && isClineUser) {
				return false
			}
		}

		return true
	})
}

/**
 * Check if action should be visible based on extension state
 */
function isActionVisible(action: BannerAction, extensionState: Record<string, boolean>): boolean {
	if (!action.visibilityCondition) {
		return true
	}

	const { requiresEnabled, requiresDisabled } = action.visibilityCondition

	// Check all required enabled states
	if (requiresEnabled) {
		for (const state of requiresEnabled) {
			if (!extensionState[state]) {
				return false
			}
		}
	}

	// Check all required disabled states
	if (requiresDisabled) {
		for (const state of requiresDisabled) {
			if (extensionState[state]) {
				return false
			}
		}
	}

	return true
}

/**
 * Render description with optional inline endAction link
 */
function renderDescription(
	description: string,
	endAction?: BannerAction,
	actionHandler?: (action: BannerAction) => void,
): React.ReactNode {
	if (!endAction) {
		return description
	}

	const isLink = endAction.action === BannerActionType.Link && endAction.arg
	const url = isLink ? endAction.arg : undefined

	return (
		<span>
			{description}{" "}
			<a
				className="cursor-pointer"
				href={url}
				onClick={
					!url && actionHandler
						? (e) => {
								e.preventDefault()
								actionHandler(endAction)
							}
						: undefined
				}>
				{endAction.title}
			</a>
		</span>
	)
}

/**
 * Backend banner format returned from server API
 */
export interface BackendBanner {
	id: string
	isEnabled: boolean
	titleMd: string
	bodyMd: string
	severity: "info" | "success" | "warning"
	placement: "top" | "bottom"
	rulesJson: string
	activeFrom?: string // ISO 8601 date-time
	activeTo?: string // ISO 8601 date-time
	createdAt?: string
	updatedAt?: string
}

/**
 * Targeting rules structure from backend rulesJson
 */
interface BannerRules {
	ide?: string[] // e.g., ["vscode", "dashboard"]
	audience?: string[] // e.g., ["all", "cline_users", "non_cline_users"]
	platforms?: ("windows" | "mac" | "linux")[]
	actions?: Array<
		BannerAction & {
			isEndAction?: boolean
		}
	>
}

/**
 * Convert backend Banner JSON to frontend BannerCardData
 */
export function convertBackendBanner(backendBanner: BackendBanner): BannerCardData {
	// Parse targeting rules
	let rules: BannerRules = {}
	try {
		rules = JSON.parse(backendBanner.rulesJson)
	} catch (e) {
		console.warn("Failed to parse banner rulesJson:", e)
	}

	// Map severity string to enum
	const severityMap: Record<string, BannerSeverity> = {
		info: BannerSeverity.Info,
		success: BannerSeverity.Success,
		warning: BannerSeverity.Warning,
	}

	// Determine clineUserOnly from audience rules
	let clineUserOnly: boolean | undefined
	if (rules.audience?.includes("cline_users") && !rules.audience?.includes("non_cline_users")) {
		clineUserOnly = true
	} else if (rules.audience?.includes("non_cline_users") && !rules.audience?.includes("cline_users")) {
		clineUserOnly = false
	}

	// Extract actions and endAction from rules
	const actions = rules.actions?.filter((action) => !action.isEndAction)
	const endAction = rules.actions?.find((action) => action.isEndAction)

	// Build BannerCardData
	return {
		id: backendBanner.id,
		title: backendBanner.titleMd,
		description: backendBanner.bodyMd,
		severity: severityMap[backendBanner.severity],
		isEnabled: backendBanner.isEnabled,
		clineUserOnly,
		platforms: rules.platforms,
		active: {
			from: backendBanner.activeFrom,
			to: backendBanner.activeTo,
		},
		actions,
		endAction,
	}
}

/**
 * Convert BannerCardData to BannerData for rendering
 */
export function convertBannerData(
	banner: BannerCardData,
	handlers: {
		onAction: (action: BannerAction) => void
		onDismiss: (bannerId: string) => void
	},
	options: {
		currentPlatform: "windows" | "mac" | "linux"
		isClineUser: boolean
		extensionState: Record<string, boolean>
	},
): BannerData {
	const { onAction, onDismiss } = handlers
	const { currentPlatform, isClineUser, extensionState } = options

	// Filter and process actions
	const filteredActions = filterActions(banner.actions, { currentPlatform, isClineUser })
		.filter((action) => isActionVisible(action, extensionState))
		.map((action) => ({
			label: action.title,
			onClick: () => onAction(action),
			variant: (action.variant ?? "primary") as BannerAction["variant"],
			disabled: action.disabled,
		}))

	// Filter endAction
	const filteredEndAction =
		banner.endAction &&
		filterActions([banner.endAction], { currentPlatform, isClineUser }).length > 0 &&
		isActionVisible(banner.endAction, extensionState)
			? banner.endAction
			: undefined

	return {
		id: banner.id,
		icon: banner.icon ? (
			<DynamicIcon className="size-4" name={banner.icon as React.ComponentProps<typeof DynamicIcon>["name"]} />
		) : undefined,
		title: banner.title,
		description: renderDescription(banner.description, filteredEndAction, onAction),
		actions: filteredActions.length > 0 ? filteredActions : undefined,
		onDismiss: () => onDismiss(banner.id),
		severity: banner.severity,
	}
}
