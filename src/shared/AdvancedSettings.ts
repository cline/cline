export interface ClineConfiguration {
	vsCodeLmModelSelector?: {
		vendor?: string
		family?: string
	}
	mcp: {
		mode: "full" | "server-use-only" | "off"
	}
	enableCheckpoints: boolean
	enableTelemetry: boolean
}

export const DEFAULT_ADVANCED_SETTINGS: ClineConfiguration = {
	mcp: {
		mode: "full",
	},
	enableCheckpoints: true,
	enableTelemetry: false,
}
