/**
 * Shared types for the MacM4LocalAgent UI components.
 *
 * Mirrors the JSON shape returned by the M7 dashboard endpoint
 * (http://127.0.0.1:4001/api/macm4-models). If the schema changes,
 * bump the schema_version field and adjust the parser in useMacM4Models.
 */

export type MacM4TierKind = "local" | "cloud" | "router"
export type MacM4Backend = "mlx" | "ollama" | "anthropic" | "litellm-router"

export interface MacM4ModelEntry {
	id: string
	tier: MacM4TierKind
	backend: MacM4Backend
	backend_url?: string
	context_window: number
	max_output_tokens: number
	tokens_per_second_est?: number
	warm?: boolean
	pricing: {
		input_per_million_usd: number | null
		output_per_million_usd: number | null
	}
	capabilities: {
		streaming: boolean
		tool_use_native: boolean
		vision: boolean
	}
	note?: string
}

export interface MacM4ModelsResponse {
	data: MacM4ModelEntry[]
	object: "list"
	_meta: {
		schema_version: number
		generated_at: number
		dashboard_url: string
		proxy_url: string
	}
}

/**
 * Cost-savings stat sourced from the existing dashboard /api/stats
 * (or the saved /cost summary). Only the fields we actually render
 * are typed; the dashboard returns plenty of extra detail that we
 * pass through opaquely.
 */
export interface MacM4SavingsSummary {
	actual_cost_usd: number
	shadow_cost_usd: number
	savings_usd: number
	savings_pct: number
	requests_total: number
	requests_local: number
	requests_cloud: number
	window_label: string
}
