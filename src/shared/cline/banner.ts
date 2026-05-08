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

	/**
	 * Optional model picker tab to open when using SetModel action
	 */
	tab?: "recommended" | "free"
}

/**
 * The list of predefined banner config rendered by the Welcome Section UI.
 * TODO: Backend would return a similar JSON structure in the future which we will replace this with.
 */

export const BANNER_DATA: BannerCardData[] = []
