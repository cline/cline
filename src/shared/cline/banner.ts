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
 * Backend banner format returned from server API
 */
export interface BackendBanner {
	id: string
	titleMd: string
	bodyMd: string
	rulesJson: string
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

	/** Banner description/body markdown text */
	description: string

	/**
	 * Icon ID from Lucide icon set (e.g., "lightbulb", "megaphone", "terminal")
	 * LINK: https://lucide.dev/icons/
	 * Optional - if omitted, no icon is shown
	 */
	icon?: string

	/**
	 * Optional footer action buttons
	 * Rendered below the description as prominent buttons
	 */
	actions?: BannerAction[]

	/**
	 * Platform filter - only show on specified platforms
	 * If undefined, show on all platforms
	 */
	platforms?: ("windows" | "mac" | "linux")[]

	/** Only show to Cline users */
	isClineUserOnly?: boolean
}

/**
 * Single action definition (button or link)
 */
export interface BannerAction {
	/** Button/link label text */
	title: string

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
			"For the best experience, drag the Cline icon to your right sidebar. This keeps your file explorer and editor visible while you chat with Cline, making it easier to navigate your codebase and see changes in real-time. [See how →](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)",
	},

	// Announcement with conditional actions based on user auth state
	{
		id: "new-model-opus-4-5-cline-users",
		icon: "megaphone",
		title: "Claude Opus 4.5 Now Available",
		description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
		actions: [
			{
				title: "Try Now",
				action: BannerActionType.SetModel,
				arg: "anthropic/claude-opus-4.5",
			},
		],
		isClineUserOnly: true, // Only Cline users see this
	},

	{
		id: "new-model-opus-4-5-non-cline-users",
		icon: "megaphone",
		title: "Claude Opus 4.5 Now Available",
		description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
		actions: [
			{
				title: "Get Started",
				action: BannerActionType.ShowAccount,
			},
		],
		isClineUserOnly: false, // Only non-Cline users see this
	},

	// Platform-specific banner (macOS/Linux)
	{
		id: "cli-install-unix-v1",
		icon: "terminal",
		title: "CLI & Subagents Available",
		platforms: ["mac", "linux"] satisfies BannerCardData["platforms"],
		description:
			"Use Cline in your terminal and enable subagent capabilities. [Learn more](https://docs.cline.bot/cline-cli/overview)",
		actions: [
			{
				title: "Install",
				action: BannerActionType.InstallCli,
			},
			{
				title: "Enable Subagents",
				action: BannerActionType.ShowFeatureSettings,
			},
		],
	},

	// Platform-specific banner (Windows)
	{
		id: "cli-info-windows-v1",
		icon: "terminal",
		title: "Cline CLI Info",
		platforms: ["windows"] satisfies BannerCardData["platforms"],
		description:
			"Available for macOS and Linux. Coming soon to other platforms. [Learn more](https://docs.cline.bot/cline-cli/overview)",
	},
]
