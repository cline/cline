export enum BannerSeverity {
	Info = "info",
	Success = "success",
	Warning = "warning",
}

/**
 * Banner data structure for backend-to-frontend communication.
 * Backend constructs this JSON, frontend renders it via BannerCarousel.
 */
export interface BannerCardData {
	/** Unique identifier for the banner (used for dismissal tracking) */
	id: string

	/** Banner title text */
	title: string

	/** Banner description/body text */
	description: string

	/**
	 * Icon ID from Lucide icon set (e.g., "lightbulb", "megaphone", "terminal")
	 * LINK: https://lucide.dev/icons/
	 * Optional - if omitted, no icon is shown
	 */
	icon?: string

	/**
	 * Severity level determines styling
	 */
	severity?: BannerSeverity

	/**
	 * Optional inline action displayed at the end of the description text
	 * Rendered as a link or button in the text flow
	 */
	endAction?: BannerAction

	/**
	 * Optional footer action buttons
	 * Rendered below the description as prominent buttons
	 */
	actions?: BannerAction[]

	/**
	 * If true, only show banner to users logged in with Cline account
	 * If false, only show to non-Cline users
	 * If undefined, show to all users
	 */
	clineUserOnly?: boolean

	/**
	 * Platform filter - only show on specified platforms
	 * If undefined, show on all platforms
	 */
	platforms?: ("windows" | "mac" | "linux")[]

	/**
	 * Time window for displaying the banner
	 * If undefined, display indefinitely
	 */
	active?: {
		/** Start date (ISO 8601 string) - show banner on/after this date */
		from?: string
		/** End date (ISO 8601 string) - hide banner after this date */
		to?: string
	}

	isEnabled: boolean
}

/**
 * Action types that can be triggered from banner buttons/links
 * Frontend maps these to actual handlers
 */
export enum BannerActionType {
	/** Open external URL */
	Link = "link",
	/** Open API settings tab */
	ShowApiSettings = "show-api-settings",
	/** Open feature settings tab */
	ShowFeatureSettings = "show-feature-settings",
	/** Open account/login view */
	ShowAccount = "show-account",
	/** Set the active model */
	SetModel = "set-model",
	/** Trigger CLI installation flow */
	InstallCli = "install-cli",
}

/**
 * Single action definition (button or link)
 */
export interface BannerAction {
	/** Button/link label text */
	title: string

	/**
	 * Icon ID from Lucide icon set (optional)
	 * See: https://lucide.dev/icons/
	 */
	icon?: string

	/**
	 * Action type - determines what happens on click
	 * Defaults to "link" if omitted
	 */
	action?: BannerActionType

	/**
	 * Action argument - interpretation depends on action type:
	 * - Link: URL to open
	 * - SetModel: model ID (e.g., "anthropic/claude-opus-4.5")
	 * - Others: generally unused
	 */
	arg?: string

	/**
	 * If true, only show action to Cline users
	 * If false, only show to non-Cline users
	 * If undefined, show to all users
	 */
	clineUserOnly?: boolean

	/**
	 * Platform filter - only show on specified platforms
	 * If undefined, show on all platforms
	 */
	platforms?: ("windows" | "mac" | "linux")[]

	/**
	 * If true, render button in disabled state
	 */
	disabled?: boolean

	/**
	 * Button style variant
	 * If undefined, uses "default"
	 */
	variant?: "default" | "secondary" | "danger" | "outline" | "ghost"

	/**
	 * Conditional visibility based on extension state
	 * Action is hidden if conditions aren't met
	 */
	visibilityCondition?: {
		/**
		 * Show action ONLY if all these states are true
		 * e.g., ["subagentsEnabled"] = only show if subagents enabled
		 */
		requiresEnabled?: string[]

		/**
		 * Show action ONLY if all these states are false
		 * e.g., ["subagentsEnabled"] = only show if subagents NOT enabled
		 */
		requiresDisabled?: string[]
	}
}

/**
 * The list of predefined banner config rendered by the Welcome Section UI.
 * TODO: Backend would return a similar JSON structure in the future which we will replace this with.
 */
export const BANNER_DATA: BannerCardData[] = [
	// Info banner with inline link
	{
		id: "info-banner-v1",
		icon: "lightbulb",
		title: "Use Cline in Right Sidebar",
		description:
			"For the best experience, drag the Cline icon to your right sidebar. This keeps your file explorer and editor visible while you chat with Cline, making it easier to navigate your codebase and see changes in real-time.",
		endAction: {
			title: "See how →",
			action: BannerActionType.Link,
			arg: "https://docs.cline.bot/features/customization/opening-cline-in-sidebar",
		},
		isEnabled: true,
	},

	// Announcement with conditional actions based on user auth state
	{
		id: "new-model-opus-4-5",
		icon: "megaphone",
		title: "Claude Opus 4.5 Now Available",
		description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
		actions: [
			{
				title: "Try Now",
				action: BannerActionType.SetModel,
				arg: "anthropic/claude-opus-4.5",
				clineUserOnly: true, // Only Cline users see this
			},
			{
				title: "Get Started",
				action: BannerActionType.ShowAccount,
				clineUserOnly: false, // Only non-Cline users see this
			},
		],
		isEnabled: true,
	},

	// Platform-specific banner (macOS/Linux)
	{
		id: "cli-install-unix-v1",
		icon: "terminal",
		title: "CLI & Subagents Available",
		platforms: ["mac", "linux"] satisfies BannerCardData["platforms"],
		description: "Use Cline in your terminal and enable subagent capabilities.",
		endAction: {
			title: "Learn more",
			action: BannerActionType.Link,
			arg: "https://docs.cline.bot/cline-cli/overview",
		},
		actions: [
			{
				title: "Install",
				action: BannerActionType.InstallCli,
			},
			{
				title: "Enable Subagents",
				action: BannerActionType.ShowFeatureSettings,
				// Only show if subagents NOT already enabled
				visibilityCondition: {
					requiresDisabled: ["subagentsEnabled"],
				},
			},
		],
		isEnabled: true,
	},

	// Platform-specific banner (Windows)
	{
		id: "cli-info-windows-v1",
		icon: "terminal",
		title: "Cline CLI Info",
		platforms: ["windows"] satisfies BannerCardData["platforms"],
		description: "Available for macOS and Linux. Coming soon to other platforms.",
		endAction: {
			title: "Learn more",
			action: BannerActionType.Link,
			arg: "https://docs.cline.bot/cline-cli/overview",
		},
		isEnabled: true,
	},
].filter((banner) => banner.isEnabled)

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
interface BackendBannerRules {
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
	let rules: BackendBannerRules = {}
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
