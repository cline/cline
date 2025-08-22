import { ModelFamily } from "@/shared/prompts"
import { getModelFamily } from ".."
import { getSystemPromptComponents } from "../components"
import { registerClineToolSets } from "../tools"
import type { ComponentFunction, ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { PromptBuilder } from "./PromptBuilder"

export class PromptRegistry {
	private static instance: PromptRegistry
	private variants: Map<string, PromptVariant> = new Map()
	private components: ComponentRegistry = {}
	private loaded: boolean = false

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

		this.loaded = true
	}

	/**
	 * Get prompt by model ID with fallback to generic
	 */
	async get(context: SystemPromptContext): Promise<string> {
		await this.load()

		// Try model family fallback (e.g., "claude-4" -> "claude")
		const modelFamily = getModelFamily(context.providerInfo)
		const variant = this.variants.get(modelFamily ?? ModelFamily.GENERIC)

		if (!variant) {
			throw new Error(
				`No prompt variant found for model '${context.providerInfo.modelId}' and no generic fallback available`,
			)
		}

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
	private async loadVariants(): Promise<void> {
		try {
			const { VARIANT_CONFIGS } = await import("../variants")

			// Load each variant configuration
			const loadPromises = Object.entries(VARIANT_CONFIGS).map(async ([variantId, configLoader]) => {
				try {
					const config = await configLoader()
					await this.loadVariantFromConfig(variantId, config)
				} catch (error) {
					console.warn(`Warning: Could not load variant '${variantId}':`, error)
				}
			})

			await Promise.all(loadPromises)
		} catch (error) {
			console.warn("Warning: Could not load variants:", error)
		}
	}

	/**
	 * Load a single variant from its TypeScript config
	 */
	private async loadVariantFromConfig(variantId: string, config: Omit<PromptVariant, "id">): Promise<void> {
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
