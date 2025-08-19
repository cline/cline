import fs from "node:fs/promises"
import path from "node:path"
import type { ComponentFunction, ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { ModelFamily } from "../types"
import { PromptBuilder } from "./PromptBuilder"
import { extractModelFamily } from "./utils"

export class PromptRegistry {
	private static instance: PromptRegistry
	private variants: Map<string, PromptVariant> = new Map()
	private components: ComponentRegistry = {}
	private loaded: boolean = false
	private readonly variantsDir: string
	// private readonly componentsDir: string;

	private constructor() {
		const baseDir = path.dirname(__dirname)
		this.variantsDir = path.join(baseDir, "variants")
		// this.componentsDir = path.join(baseDir, "components");
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
	async get(modelId: string, context: SystemPromptContext): Promise<string> {
		await this.load()

		// Try model family fallback (e.g., "claude-4" -> "claude")
		const modelFamily = extractModelFamily(modelId)
		const variant = this.variants.get(modelFamily ?? ModelFamily.GENERIC)

		if (!variant) {
			throw new Error(`No prompt variant found for model '${modelId}' and no generic fallback available`)
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
			// Import all component files dynamically
			const componentModules = await Promise.all([
				import("../components/system_info"),
				import("../components/mcp"),
				import("../components/todo"),
				import("../components/user_instructions"),
				import("../components/tool_use"),
				import("../components/editing_files"),
				import("../components/capabilities"),
				import("../components/rules"),
				import("../components/objective"),
				import("../components/act_vs_plan_mode"),
				import("../components/feedback"),
			])

			// Register each component function
			const componentMappings = [
				{ id: "system_info", fn: componentModules[0].getSystemInfo },
				{ id: "mcp", fn: componentModules[1].getMcp },
				{ id: "todo", fn: componentModules[2].getTodoListSection },
				{
					id: "user_instructions",
					fn: componentModules[3].getUserInstructions,
				},
				{ id: "tool_use", fn: componentModules[4].getToolUseSection },
				{
					id: "editing_files",
					fn: componentModules[5].getEditingFilesSection,
				},
				{
					id: "capabilities",
					fn: componentModules[6].getCapabilitiesSection,
				},
				{ id: "rules", fn: componentModules[7].getRulesSection },
				{ id: "objective", fn: componentModules[8].getObjectiveSection },
				{
					id: "act_vs_plan_mode",
					fn: componentModules[9].getActVsPlanModeSection,
				},
				{
					id: "feedback",
					fn: componentModules[10].getFeedbackSection,
				},
			]

			for (const { id, fn } of componentMappings) {
				if (fn) {
					this.components[id] = fn
				}
			}
		} catch (error) {
			console.warn("Warning: Could not load some components:", error)
		}
	}
}
