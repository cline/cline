import type { McpHub } from "@/services/mcp/McpHub"
import type { BrowserSettings } from "@/shared/BrowserSettings"
import type { FocusChainSettings } from "@/shared/FocusChainSettings"
import type { ModelFamily } from "@/shared/prompts"
import type { ClineDefaultTool } from "@/shared/tools"
import type { SystemPromptSection } from "./templates/placeholders"
import type { ClineToolSpec } from "./tools/spec"

export interface ConfigOverride {
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
	description: string // Brief description of the prompt variant

	// Prompt configuration
	config: PromptConfig // Model-specific config (temperature, etc.)
	baseTemplate: string // Main prompt template with placeholders
	componentOrder: SystemPromptSection[] // Ordered list of components to include
	componentOverrides: { [K in SystemPromptSection]?: ConfigOverride } // Component-specific customizations
	placeholders: { [key: string]: string } // Default placeholder values

	// Tool configuration
	tools?: ClineDefaultTool[] // Ordered list of tools to include (if not specified, all tools are included)
	toolOverrides?: { [K in ClineDefaultTool]?: ConfigOverride } // Tool-specific customizations
}

export interface PromptConfig {
	modelName?: string
	temperature?: number
	maxTokens?: number
	tools?: ClineToolSpec[]
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
	mcpHub?: McpHub
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
