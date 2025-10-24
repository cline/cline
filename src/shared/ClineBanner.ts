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
	/** Target users with specific features enabled */
	features?: string[]
	/** Target specific version range */
	version?: {
		min?: string
		max?: string
	}
	/** Target specific audience segments */
	audience?: {
		/** Target all users */
		all?: boolean
		/** Target users who have never used workspaces */
		no_workspaces?: boolean
		/** Target team admins */
		team_admins?: boolean
	}
}
