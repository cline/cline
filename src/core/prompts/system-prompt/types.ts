/**
 * Enhanced type definitions for better type safety and developer experience
 */

import { ApiProviderInfo } from "@/core/api"
import type { McpHub } from "@/services/mcp/McpHub"
import type { BrowserSettings } from "@/shared/BrowserSettings"
import type { FocusChainSettings } from "@/shared/FocusChainSettings"
import { ModelFamily } from "@/shared/prompts"
import type { SkillMetadata } from "@/shared/skills"
import { BeadsmithDefaultTool } from "@/shared/tools"
import type { BeadsmithToolSpec } from "./spec"
import { SystemPromptSection } from "./templates/placeholders"

/**
 * Strongly typed configuration override with validation
 */
export interface ConfigOverride {
	template?: string | ((context: SystemPromptContext) => string) // Custom template for the component/tool
	enabled?: boolean // Whether the component/tool is enabled
	order?: number // Override the order of the component/tool
}

/**
 * Enhanced prompt variant with strict typing and validation
 */
export interface PromptVariant {
	readonly id: string // Model family ID (e.g., "next-gen", "generic")
	readonly version: number // Version number (must be >= 1)
	readonly tags: readonly string[] // Immutable tags array
	readonly labels: Readonly<Record<string, number>> // Immutable labels mapping
	readonly family: ModelFamily // Model family enum
	readonly description: string // Brief description of the variant
	readonly matcher: (context: SystemPromptContext) => boolean // Function to determine if this variant should be used for the given providerInfo

	// Prompt configuration
	readonly config: PromptConfig // Model-specific config
	readonly baseTemplate: string // Main prompt template with placeholders
	readonly componentOrder: readonly SystemPromptSection[] // Ordered list of components
	readonly componentOverrides: Readonly<Partial<Record<SystemPromptSection, ConfigOverride>>> // Component customizations
	readonly placeholders: Readonly<Record<string, string>> // Default placeholder values

	// Tool configuration
	readonly tools?: readonly BeadsmithDefaultTool[] // Ordered list of tools to include
	readonly toolOverrides?: Readonly<Partial<Record<BeadsmithDefaultTool, ConfigOverride>>> // Tool customizations
}

/**
 * Mutable version of PromptVariant for building
 */
export interface MutablePromptVariant {
	id?: string
	version: number
	tags: string[]
	labels: Record<string, number>
	family: ModelFamily
	description?: string
	matcher?: (providerInfo: ApiProviderInfo) => boolean
	config: PromptConfig
	baseTemplate?: string
	componentOrder: SystemPromptSection[]
	componentOverrides: Partial<Record<SystemPromptSection, ConfigOverride>>
	placeholders: Record<string, string>
	tools?: BeadsmithDefaultTool[]
	toolOverrides?: Partial<Record<BeadsmithDefaultTool, ConfigOverride>>
}

/**
 * Type-safe prompt configuration
 */
export interface PromptConfig {
	readonly modelName?: string
	readonly temperature?: number
	readonly maxTokens?: number
	readonly tools?: readonly BeadsmithToolSpec[]
	readonly [key: string]: unknown // Additional arbitrary config
}

/**
 * Version metadata with strict typing
 */
export interface VersionMetadata {
	readonly version: number
	readonly tags: readonly string[]
	readonly labels: Readonly<Record<string, number>> // label -> version mapping
	readonly changelog?: string
	readonly deprecated?: boolean
	readonly createdAt: Date
}

/**
 * Enhanced system prompt context with better typing
 */
export interface SystemPromptContext {
	readonly providerInfo: ApiProviderInfo
	readonly cwd?: string
	readonly ide: string
	readonly editorTabs?: {
		readonly open?: readonly string[]
		readonly visible?: readonly string[]
	}
	readonly supportsBrowserUse?: boolean
	readonly mcpHub?: McpHub
	readonly skills?: SkillMetadata[]
	readonly focusChainSettings?: FocusChainSettings
	readonly globalBeadsmithRulesFileInstructions?: string
	readonly localBeadsmithRulesFileInstructions?: string
	readonly localCursorRulesFileInstructions?: string
	readonly localCursorRulesDirInstructions?: string
	readonly localWindsurfRulesFileInstructions?: string
	readonly localAgentsRulesFileInstructions?: string
	readonly beadsmithIgnoreInstructions?: string
	readonly preferredLanguageInstructions?: string
	readonly browserSettings?: BrowserSettings
	readonly isTesting?: boolean
	readonly runtimePlaceholders?: Readonly<Record<string, unknown>>
	readonly yoloModeToggled?: boolean
	readonly beadsmithWebToolsEnabled?: boolean
	readonly isMultiRootEnabled?: boolean
	readonly workspaceRoots?: Array<{ path: string; name: string; vcs?: string }>
	readonly isSubagentsEnabledAndCliInstalled?: boolean
	readonly isCliSubagent?: boolean
	readonly enableNativeToolCalls?: boolean
	readonly enableParallelToolCalling?: boolean
	readonly terminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
	// Bead (Ralph Loop) context
	readonly beadModeActive?: boolean
	readonly beadDescription?: string
	readonly beadNumber?: number
	readonly beadMaxIterations?: number
	readonly beadCompletionSignal?: string
	readonly beadTestCommand?: string
	readonly beadFeedback?: string // rejection feedback from previous bead
	// DAG analysis context
	readonly dagEnabled?: boolean
	readonly dagImpact?: {
		readonly affectedFiles?: readonly string[]
		readonly affectedFunctions?: readonly string[]
		readonly suggestedTests?: readonly string[]
		readonly confidenceBreakdown?: {
			readonly high?: number
			readonly medium?: number
			readonly low?: number
			readonly unsafe?: number
		}
	}
}

/**
 * Component function with enhanced typing
 */
export type ComponentFunction = (variant: PromptVariant, context: SystemPromptContext) => Promise<string | undefined>

/**
 * Component registry with strict typing
 */
export interface ComponentRegistry {
	[componentId: string]: ComponentFunction
}

/**
 * Type-safe variant configuration for export
 */
export type VariantConfig = Omit<PromptVariant, "id">

/**
 * Utility types for better type inference
 */

// Extract component keys as literal types
export type ComponentKey = keyof typeof SystemPromptSection
export type ComponentValue = (typeof SystemPromptSection)[ComponentKey]

// Extract tool keys as literal types
export type ToolKey = keyof typeof BeadsmithDefaultTool
export type ToolValue = (typeof BeadsmithDefaultTool)[ToolKey]

// Type for variant builder methods
export type VariantBuilderMethod<T> = (this: T, ...args: any[]) => T

// Type guards
export function isValidModelFamily(family: string): family is ModelFamily {
	return Object.values(ModelFamily).includes(family as ModelFamily)
}

export function isValidSystemPromptSection(section: string): section is SystemPromptSection {
	return Object.values(SystemPromptSection).includes(section as SystemPromptSection)
}

export function isValidBeadsmithDefaultTool(tool: string): tool is BeadsmithDefaultTool {
	return Object.values(BeadsmithDefaultTool).includes(tool as BeadsmithDefaultTool)
}

/**
 * Template literal types for better string validation
 */
export type VariantName = string & { __brand: "VariantName" }
export type PlaceholderName = string & { __brand: "PlaceholderName" }
export type TemplateLiteral = string & { __brand: "TemplateLiteral" }

/**
 * Factory type for creating variants
 */
export interface VariantFactory {
	create(family: ModelFamily): VariantBuilder
	createGeneric(): VariantBuilder
	createNextGen(): VariantBuilder
	createXs(): VariantBuilder
}

/**
 * Builder interface for type-safe variant construction
 */
export interface VariantBuilder {
	description(desc: string): this
	version(version: number): this
	tags(...tags: string[]): this
	labels(labels: Record<string, number>): this
	matcher(matcherFn: (providerInfo: ApiProviderInfo) => boolean): this
	template(baseTemplate: string): this
	components(...sections: SystemPromptSection[]): this
	overrideComponent(section: SystemPromptSection, override: ConfigOverride): this
	tools(...tools: BeadsmithDefaultTool[]): this
	overrideTool(tool: BeadsmithDefaultTool, override: ConfigOverride): this
	placeholders(placeholders: Record<string, string>): this
	config(config: Record<string, any>): this
	build(): VariantConfig
}

/**
 * Validation result types
 */
export interface ValidationError {
	readonly field: string
	readonly message: string
	readonly severity: "error" | "warning"
}

export interface ValidationResult {
	readonly isValid: boolean
	readonly errors: readonly ValidationError[]
	readonly warnings: readonly ValidationError[]
}

/**
 * Registry types
 */
export interface VariantRegistryEntry {
	readonly id: string
	readonly variant: PromptVariant
	readonly metadata: VersionMetadata
}

export interface VariantRegistry {
	register(id: string, variant: PromptVariant): void
	get(id: string): PromptVariant | undefined
	getAll(): readonly VariantRegistryEntry[]
	getByFamily(family: ModelFamily): readonly PromptVariant[]
	getByTag(tag: string): readonly PromptVariant[]
	getByLabel(label: string): readonly PromptVariant[]
}

/**
 * Event types for variant lifecycle
 */
export interface VariantEvent {
	readonly type: "created" | "updated" | "deleted" | "validated"
	readonly variantId: string
	readonly timestamp: Date
	readonly metadata?: Record<string, unknown>
}

export type VariantEventHandler = (event: VariantEvent) => void

/**
 * Configuration schema types for runtime validation
 */
export interface VariantSchema {
	readonly required: readonly string[]
	readonly optional: readonly string[]
	readonly validation: Record<string, (value: unknown) => boolean>
}

/**
 * Common parameter shared between tools for tracking task progress
 */
export const TASK_PROGRESS_PARAMETER = {
	name: "task_progress",
	required: false,
	instruction: `A checklist showing task progress after this tool use is completed. The task_progress parameter must be included as a separate parameter inside of the parent tool call, it must be separate from other parameters such as content, arguments, etc. (See 'UPDATING TASK PROGRESS' section for more details)`,
	usage: "Checklist here (optional)",
	dependencies: [BeadsmithDefaultTool.TODO],
}
