/**
 * Enhanced type definitions for better type safety and developer experience
 */

import { ApiProviderInfo } from "@/core/api"
import type { McpHub } from "@/services/mcp/McpHub"
import type { BrowserSettings } from "@/shared/BrowserSettings"
import type { FocusChainSettings } from "@/shared/FocusChainSettings"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "./spec"
import { SystemPromptSection } from "./templates/placeholders"

/**
 * Strongly typed configuration override with validation
 */
export interface ConfigOverride {
	template?: string // Custom template for the component/tool
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

	// Prompt configuration
	readonly config: PromptConfig // Model-specific config
	readonly baseTemplate: string // Main prompt template with placeholders
	readonly componentOrder: readonly SystemPromptSection[] // Ordered list of components
	readonly componentOverrides: Readonly<Partial<Record<SystemPromptSection, ConfigOverride>>> // Component customizations
	readonly placeholders: Readonly<Record<string, string>> // Default placeholder values

	// Tool configuration
	readonly tools?: readonly ClineDefaultTool[] // Ordered list of tools to include
	readonly toolOverrides?: Readonly<Partial<Record<ClineDefaultTool, ConfigOverride>>> // Tool customizations
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
	config: PromptConfig
	baseTemplate?: string
	componentOrder: SystemPromptSection[]
	componentOverrides: Partial<Record<SystemPromptSection, ConfigOverride>>
	placeholders: Record<string, string>
	tools?: ClineDefaultTool[]
	toolOverrides?: Partial<Record<ClineDefaultTool, ConfigOverride>>
}

/**
 * Type-safe prompt configuration
 */
export interface PromptConfig {
	readonly modelName?: string
	readonly temperature?: number
	readonly maxTokens?: number
	readonly tools?: readonly ClineToolSpec[]
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
	readonly supportsBrowserUse?: boolean
	readonly mcpHub?: McpHub
	readonly focusChainSettings?: FocusChainSettings
	readonly globalClineRulesFileInstructions?: string
	readonly localClineRulesFileInstructions?: string
	readonly localCursorRulesFileInstructions?: string
	readonly localCursorRulesDirInstructions?: string
	readonly localWindsurfRulesFileInstructions?: string
	readonly clineIgnoreInstructions?: string
	readonly preferredLanguageInstructions?: string
	readonly browserSettings?: BrowserSettings
	readonly isTesting?: boolean
	readonly runtimePlaceholders?: Readonly<Record<string, unknown>>
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
export type ToolKey = keyof typeof ClineDefaultTool
export type ToolValue = (typeof ClineDefaultTool)[ToolKey]

// Type for variant builder methods
export type VariantBuilderMethod<T> = (this: T, ...args: any[]) => T

// Type guards
export function isValidModelFamily(family: string): family is ModelFamily {
	return Object.values(ModelFamily).includes(family as ModelFamily)
}

export function isValidSystemPromptSection(section: string): section is SystemPromptSection {
	return Object.values(SystemPromptSection).includes(section as SystemPromptSection)
}

export function isValidClineDefaultTool(tool: string): tool is ClineDefaultTool {
	return Object.values(ClineDefaultTool).includes(tool as ClineDefaultTool)
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
	template(baseTemplate: string): this
	components(...sections: SystemPromptSection[]): this
	overrideComponent(section: SystemPromptSection, override: ConfigOverride): this
	tools(...tools: ClineDefaultTool[]): this
	overrideTool(tool: ClineDefaultTool, override: ConfigOverride): this
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
	instruction: `A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)`,
	usage: "Checklist here (optional)",
	dependencies: [ClineDefaultTool.TODO],
}
