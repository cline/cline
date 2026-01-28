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
	// ChatGPT integration banner
	{
		id: "chatgpt-integration-v1",
		icon: "megaphone",
		title: "Use ChatGPT with Cline",
		description:
			"Bring your ChatGPT subscription to Cline! Use your existing plan directly with no per token costs or API keys to manage.",
		actions: [
			{
				title: "Connect",
				action: BannerActionType.ShowApiSettings,
				arg: "openai-codex", // Pre-select OpenAI Codex provider
			},
		],
	},

	// Jupyter Notebooks banner
	{
		id: "jupyter-notebooks-v1",
		icon: "book-open",
		title: "Jupyter Notebooks",
		description:
			"Comprehensive AI-assisted editing of `.ipynb` files with full cell-level context awareness. [Learn More →](https://docs.cline.bot/features/jupyter-notebooks)",
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

	// Info banner with inline link
	{
		id: "info-banner-v1",
		icon: "lightbulb",
		title: "Use Cline in Right Sidebar",
		description:
			"For the best experience, drag the Cline icon to your right sidebar. This keeps your file explorer and editor visible while you chat with Cline, making it easier to navigate your codebase and see changes in real-time. [See how →](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)",
	},
]
