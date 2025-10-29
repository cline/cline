/**
 * Banner message types for Cline extension
 */

export type BannerSeverity = "info" | "success" | "warning"
export type BannerPlacement = "top" | "bottom"

export interface Banner {
	id: string
	titleMd: string
	bodyMd: string
	severity: BannerSeverity
	placement: BannerPlacement
	rulesJson: string
	activeFrom?: string
	activeTo?: string
}

export interface BannersResponse {
	data: {
		banners: Banner[]
	}
}

/**
 * Audience targeting options
 */
export type BannerAudience = "all" | "team admin only" | "team members" | "personal only"

/**
 * Rules that can be evaluated for banner targeting
 */
export interface BannerRules {
	/** Target specific IDEs (e.g., "vscode", "jetbrains") */
	ide?: string[]
	/** Target specific auth providers (e.g., "firebase", "workos") */
	auth?: string[]
	/** Target employees only */
	employee_only?: boolean
	/** Target users with specific API providers (e.g., "anthropic", "openai") */
	providers?: string[]
	/** Target specific audience segment */
	audience?: BannerAudience
}
