import type { BrowserSettings } from "@/shared/BrowserSettings"
import type { FocusChainSettings } from "@/shared/FocusChainSettings"

// Define ModelFamily enum locally since it doesn't exist in shared
export enum ModelFamily {
	CLAUDE = "claude",
	GPT = "gpt",
	GEMINI = "gemini",
	QWEN = "qwen",
	NEXT_GEN = "next-gen",
	GENERIC = "generic",
}

// Define available tool names
export type ToolName =
	| "execute_command"
	| "read_file"
	| "write_to_file"
	| "replace_in_file"
	| "search_files"
	| "list_files"
	| "list_code_definition_names"
	| "browser_action"
	| "web_fetch"
	| "use_mcp_tool"
	| "access_mcp_resource"
	| "ask_followup_question"
	| "attempt_completion"
	| "new_task"
	| "plan_mode_respond"
	| "load_mcp_documentation"

export interface ToolOverride {
	template?: string // Custom template for the tool
	enabled?: boolean // Whether the tool is enabled
	order?: number // Override the order of the tool
}

export interface PromptVariant {
	id: string // Model ID (e.g., "claude-4", "gpt-4", "gemini-pro")
	version: number // Version number
	tags: string[] // ["production", "beta", "experimental"]
	labels: { [key: string]: number } // {"staging": 2, "prod": 1}
	family: ModelFamily

	// Prompt configuration
	config: PromptConfig // Model-specific config (temperature, etc.)
	baseTemplate: string // Main prompt template with placeholders
	componentOrder: string[] // Ordered list of components to include
	componentOverrides: ComponentOverrides // Component-specific customizations
	placeholders: { [key: string]: any } // Default placeholder values

	// Tool configuration
	tools?: ToolName[] // Ordered list of tools to include (if not specified, all tools are included)
	toolOverrides?: { [K in ToolName]?: ToolOverride } // Tool-specific customizations
}

export interface PromptConfig {
	modelName?: string
	temperature?: number
	maxTokens?: number
	tools?: ToolConfig[]
	// Other arbitrary JSON config
	[key: string]: any
}

export interface ToolConfig {
	name: string
	description: string
	parameters?: any
}

export interface ComponentOverrides {
	[componentId: string]: {
		template?: string
		enabled?: boolean
		order?: number
		config?: any
	}
}

export interface VersionMetadata {
	version: number
	tags: string[]
	labels: { [label: string]: number } // label -> version mapping
	changelog?: string
	deprecated?: boolean
	createdAt: Date
}

// Define SystemPromptContext here since we can't import from shared
export interface SystemPromptContext {
	cwd?: string
	supportsBrowserUse?: boolean
	mcpHub?: {
		getServers(): any[]
	}
	focusChainSettings?: FocusChainSettings
	globalClineRulesFileInstructions?: string
	localClineRulesFileInstructions?: string
	localCursorRulesFileInstructions?: string
	localCursorRulesDirInstructions?: string
	localWindsurfRulesFileInstructions?: string
	clineIgnoreInstructions?: string
	preferredLanguageInstructions?: string
	browserSettings?: BrowserSettings
	isTesting?: boolean
}

export type ComponentFunction = (variant: PromptVariant, context: SystemPromptContext) => Promise<string | undefined>

export interface ComponentRegistry {
	[componentId: string]: ComponentFunction
}

// Legacy type alias for backward compatibility
export type ClinePromptVariant = PromptVariant
