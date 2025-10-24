/**
 * Banner message types for Cline extension
 */

export type BannerSeverity = "info" | "success" | "warning"
export type BannerPlacement = "top" | "bottom"

export interface Banner {
	id: string
	title_md: string
	body_md: string
	severity: BannerSeverity
	placement: BannerPlacement
	rules_json: string
	active_from?: string
	active_to?: string
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
	ide?: string[]
	auth?: string[]
	employee_only?: boolean[]
	providers?: string[]
	features?: string[]
	version?: {
		min?: string
		max?: string
	}
}
