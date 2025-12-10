import { ModelFamily } from "@/shared/prompts"
import type { ClineTool } from "@/shared/tools"
import { ClineToolSet } from ".."
import { getSystemPromptComponents } from "../components"
import { registerClineToolSets } from "../tools"
import type { ComponentFunction, ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { loadAllVariantConfigs } from "../variants"
import { config as genericConfig } from "../variants/generic/config"
import { PromptBuilder } from "./PromptBuilder"

export class PromptRegistry {
	private static instance: PromptRegistry
	private variants: Map<string, PromptVariant> = new Map()
	private components: ComponentRegistry = {}
	private loaded: boolean = false
	public nativeTools: ClineTool[] | undefined = undefined

	private constructor() {
		registerClineToolSets()
	}

	static getInstance(): PromptRegistry {
		if (!PromptRegistry.instance) {
			PromptRegistry.instance = new PromptRegistry()
		}
		return PromptRegistry.instance
	}

	/**
	 * Load all prompts and components on initialization
	 */
	async load(): Promise<void> {
		if (this.loaded) {
			return
		}

		await Promise.all([this.loadVariants(), this.loadComponents()])

		// Perform health check to ensure critical variants are available
		this.performHealthCheck()

		this.loaded = true
	}

	/**
	 * Perform health check to ensure registry is in a valid state
	 */
	private performHealthCheck(): void {
		const criticalVariants = [ModelFamily.GENERIC]
		const missingVariants = criticalVariants.filter((variant) => !this.variants.has(variant))

		if (missingVariants.length > 0) {
			console.error(`Registry health check failed: Missing critical variants: ${missingVariants.join(", ")}`)
			console.error(`Available variants: ${Array.from(this.variants.keys()).join(", ")}`)
		}

		if (this.variants.size === 0) {
			console.error("Registry health check failed: No variants loaded at all")
		}

		if (Object.keys(this.components).length === 0) {
			console.warn("Registry health check warning: No components loaded")
		}

		console.log(
			`Registry health check: ${this.variants.size} variants, ${Object.keys(this.components).length} components loaded`,
		)
	}

	getModelFamily(context: SystemPromptContext) {
		// Ensure providerInfo and model ID are available
		if (context.providerInfo?.model?.id) {
			// Loop through all registered variants to find the first one that matches
			for (const [_, v] of this.variants.entries()) {
				try {
					if (v.matcher(context)) {
						return v.family
					}
				} catch {
					// Continue to next variant if matcher throws
				}
			}
		}
		// Fallback to generic variant if no match found
		console.log("No matching variant found, falling back to generic")
		return ModelFamily.GENERIC
	}
	/**
	 * Get prompt by matching against all registered variants
	 */
	async get(context: SystemPromptContext): Promise<string> {
		await this.load()

		// Loop through all registered variants to find the first one that matches
		const family = this.getModelFamily(context)

		// Fallback to generic variant if no match found

		const variant = this.variants.get(family)

		if (!variant) {
			// Enhanced error with debugging information
			const availableVariants = Array.from(this.variants.keys())
			const errorDetails = {
				requestedModel: context.providerInfo.model.id,
				availableVariants,
				variantsCount: this.variants.size,
				componentsCount: Object.keys(this.components).length,
				isLoaded: this.loaded,
			}

			console.error("Prompt variant lookup failed:", errorDetails)

			throw new Error(
				`No prompt variant found for model '${context.providerInfo.model.id}' and no generic fallback available. ` +
					`Available variants: [${availableVariants.join(", ")}]. ` +
					`Registry state: loaded=${this.loaded}, variants=${this.variants.size}, components=${Object.keys(this.components).length}`,
			)
		}

		// Hacky way to get native tools for the current variant - it's bad and ugly
		this.nativeTools = ClineToolSet.getNativeTools(variant, context)

		const builder = new PromptBuilder(variant, context, this.components)
		return await builder.build()
	}

	/**
	 * Get specific version of a prompt
	 */
	async getVersion(
		modelId: string,
		version: number,
		context: SystemPromptContext,
		isNextGenModelFamily?: boolean,
	): Promise<string> {
		await this.load()

		// If isNextGenModelFamily is true, prioritize next-gen variant with the specified version
		if (isNextGenModelFamily) {
			const nextGenVariant = this.variants.get(ModelFamily.NEXT_GEN)
			if (nextGenVariant && nextGenVariant.version === version) {
				const builder = new PromptBuilder(nextGenVariant, context, this.components)
				return await builder.build()
			}
		}

		// Find variant with specific version
		const variantKey = `${modelId}@${version}`
		let variant = this.variants.get(variantKey)

		if (!variant) {
			// Look for variant with that version number
			for (const [key, v] of this.variants.entries()) {
				if (key.startsWith(modelId) && v.version === version) {
					variant = v
					break
				}
			}
		}

		if (!variant) {
			throw new Error(`No prompt variant found for model '${modelId}' version ${version}`)
		}

		const builder = new PromptBuilder(variant, context, this.components)
		return await builder.build()
	}

	/**
	 * Get prompt by tag/label
	 */
	async getByTag(
		modelId: string,
		tag?: string,
		label?: string,
		context?: SystemPromptContext,
		isNextGenModelFamily?: boolean,
	): Promise<string> {
		await this.load()

		if (!context) {
			throw new Error("Context is required for prompt building")
		}

		let variant: PromptVariant | undefined

		// If isNextGenModelFamily is true, prioritize next-gen variant with matching tag/label
		if (isNextGenModelFamily) {
			const nextGenVariant = this.variants.get(ModelFamily.NEXT_GEN)
			if (nextGenVariant) {
				// Check if next-gen variant matches the criteria
				const matchesLabel = label && nextGenVariant.labels[label] !== undefined
				const matchesTag = tag && nextGenVariant.tags.includes(tag)
				if (matchesLabel || matchesTag) {
					variant = nextGenVariant
				}
			}
		}

		// Find by label first (more specific)
		if (!variant && label) {
			for (const v of this.variants.values()) {
				if (v.id === modelId && v.labels[label] !== undefined) {
					variant = v
					break
				}
			}
		}

		// Find by tag
		if (!variant && tag) {
			for (const v of this.variants.values()) {
				if (v.id === modelId && v.tags.includes(tag)) {
					variant = v
					break
				}
			}
		}

		if (!variant) {
			throw new Error(`No prompt variant found for model '${modelId}' with tag '${tag}' or label '${label}'`)
		}

		const builder = new PromptBuilder(variant, context, this.components)
		return await builder.build()
	}

	/**
	 * Register a component function
	 */
	registerComponent(id: string, componentFn: ComponentFunction): void {
		this.components[id] = componentFn
	}

	/**
	 * Get list of available model IDs
	 */
	getAvailableModels(): string[] {
		const models = new Set<string>()
		for (const variant of this.variants.values()) {
			models.add(variant.id)
		}
		return Array.from(models)
	}

	/**
	 * Get variant metadata
	 */
	getVariantMetadata(modelId: string): PromptVariant | undefined {
		return this.variants.get(modelId)
	}

	/**
	 * Load all variants from the variants directory
	 */
	private loadVariants(): void {
		try {
			this.variants = new Map<string, PromptVariant>()

			for (const [id, config] of Object.entries(loadAllVariantConfigs())) {
				this.variants.set(id, { ...config, id })
			}

			// Ensure generic variant is always available as a safety fallback
			this.ensureGenericFallback()
		} catch (error) {
			console.warn("Warning: Could not load variants:", error)
			// Even if variant loading fails completely, create a minimal generic fallback
			this.createMinimalGenericFallback()
		}
	}

	/**
	 * Ensure generic variant is available, create minimal one if missing
	 */
	private ensureGenericFallback(): void {
		if (!this.variants.has(ModelFamily.GENERIC)) {
			console.warn("Generic variant not found, creating minimal fallback")
			this.createMinimalGenericFallback()
		}
	}

	/**
	 * Create a minimal generic variant as absolute fallback
	 */
	private createMinimalGenericFallback(): void {
		this.loadVariantFromConfig(ModelFamily.GENERIC, genericConfig)
	}

	/**
	 * Load a single variant from its TypeScript config
	 */
	private loadVariantFromConfig(variantId: string, config: Omit<PromptVariant, "id">): void {
		try {
			const variant: PromptVariant = {
				...config,
				id: variantId,
			}

			this.variants.set(variantId, variant)

			// Also register with version suffix if specified
			if (variant.version > 1) {
				this.variants.set(`${variantId}@${variant.version}`, variant)
			}
		} catch (error) {
			console.warn(`Warning: Could not load variant '${variantId}':`, error)
		}
	}

	/**
	 * Load all components from the components directory
	 */
	private async loadComponents(): Promise<void> {
		try {
			// Register each component function
			const componentMappings = getSystemPromptComponents()

			for (const { id, fn } of componentMappings) {
				if (fn) {
					this.components[id] = fn
				}
			}
		} catch (error) {
			console.warn("Warning: Could not load some components:", error)
		}
	}

	public static dispose(): void {
		PromptRegistry.instance = null as unknown as PromptRegistry
	}
}
