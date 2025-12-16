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
		items: Banner[]
		nextToken: string
	}
	success: boolean
}

/**
 * Audience targeting options
 */
export type BannerAudience = "all" | "team_admin_only" | "team_members" | "personal_only"

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
	audience?: BannerAudience[]
	/**  Target team vs enterprise organizations */
	org_type?: "all" | "team_only" | "enterprise_only" | ""
	/** Minimum extension version required (e.g., "3.39.2") */
	min_extension_version?: string
}

/**
 * Banner event types for telemetry
 */
export type BannerEventType = "dismiss"

/**
 * Banner event payload sent to the telemetry API
 */
export interface BannerEventPayload {
	banner_id: string
	instance_id: string
	surface: "vscode" | "jetbrains" | "cli"
	event_type: BannerEventType
}

/**
 * Tracks when a banner was dismissed by a user
 */
export interface BannerDismissal {
	bannerId: string
	dismissedAt: number // timestamp
}
