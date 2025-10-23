import { ModelFamily } from "@/shared/prompts"
import { type ClineToolSpec, toolSpecFunctionDeclarations, toolSpecFunctionDefinition, toolSpecInputSchema } from "../spec"
import { PromptVariant, SystemPromptContext } from "../types"

export class ClineToolSet {
	// A list of tools mapped by model group
	private static variants: Map<ModelFamily, Set<ClineToolSet>> = new Map()

	private constructor(
		public readonly id: string,
		public readonly config: ClineToolSpec,
	) {
		this._register()
	}

	public static register(config: ClineToolSpec): ClineToolSet {
		return new ClineToolSet(config.id, config)
	}

	private _register(): void {
		const existingTools = ClineToolSet.variants.get(this.config.variant) || new Set()
		if (!Array.from(existingTools).some((t) => t.config.id === this.config.id)) {
			existingTools.add(this)
			ClineToolSet.variants.set(this.config.variant, existingTools)
		}
	}

	public static getTools(variant: ModelFamily): ClineToolSet[] {
		const toolsSet = ClineToolSet.variants.get(variant) || new Set()
		const defaultSet = ClineToolSet.variants.get(ModelFamily.GENERIC) || new Set()

		return toolsSet ? Array.from(toolsSet) : Array.from(defaultSet)
	}

	public static getRegisteredModelIds(): string[] {
		return Array.from(ClineToolSet.variants.keys())
	}

	public static getToolByName(toolName: string, variant: ModelFamily): ClineToolSet | undefined {
		const tools = ClineToolSet.getTools(variant)
		return tools.find((tool) => tool.config.id === toolName)
	}

	// Return a tool by name with fallback to GENERIC and then any other variant where it exists
	public static getToolByNameWithFallback(toolName: string, variant: ModelFamily): ClineToolSet | undefined {
		// Try exact variant first
		const exact = ClineToolSet.getToolByName(toolName, variant)
		if (exact) {
			return exact
		}

		// Fallback to GENERIC
		const generic = ClineToolSet.getToolByName(toolName, ModelFamily.GENERIC)
		if (generic) {
			return generic
		}

		// Final fallback: search across all registered variants
		for (const [, tools] of ClineToolSet.variants) {
			const found = Array.from(tools).find((t) => t.config.id === toolName)
			if (found) {
				return found
			}
		}

		return undefined
	}

	// Build a list of tools for a variant using requested ids, falling back to GENERIC when missing
	public static getToolsForVariantWithFallback(variant: ModelFamily, requestedIds: string[]): ClineToolSet[] {
		const resolved: ClineToolSet[] = []
		for (const id of requestedIds) {
			const tool = ClineToolSet.getToolByNameWithFallback(id, variant)
			if (tool) {
				// Avoid duplicates by id
				if (!resolved.some((t) => t.config.id === tool.config.id)) {
					resolved.push(tool)
				}
			}
		}
		return resolved
	}

	public static getEnabledTools(variant: PromptVariant, context: SystemPromptContext): ClineToolSet[] {
		const resolved: ClineToolSet[] = []
		const requestedIds = variant.tools ? [...variant.tools] : []
		for (const id of requestedIds) {
			const tool = ClineToolSet.getToolByNameWithFallback(id, variant.family)
			if (tool) {
				// Avoid duplicates by id
				if (!resolved.some((t) => t.config.id === tool.config.id)) {
					resolved.push(tool)
				}
			}
		}

		// Filter by context requirements
		const enabledTools = resolved.filter(
			(tool) => !tool.config.contextRequirements || tool.config.contextRequirements(context),
		)

		return enabledTools
	}
	public static getNativeTools(variant: PromptVariant, context: SystemPromptContext) {
		// Only return tool functions if the variant explicitly enables them
		// via the "use_native_tools" label set to 1
		// This avoids exposing tools to models that don't support them
		// or variants that aren't designed for tool use
		if (variant.labels["use_native_tools"] !== 1) {
			return undefined
		}
		const enabledTools = ClineToolSet.getEnabledTools(variant, context)
		if (context.providerInfo.providerId === "anthropic") {
			return enabledTools.map((tool) => toolSpecInputSchema(tool.config, context))
		}
		if (context.providerInfo.providerId === "gemini") {
			return enabledTools.map((tool) => toolSpecFunctionDeclarations(tool.config, context))
		}
		return enabledTools.map((tool) => toolSpecFunctionDefinition(tool.config, context))
	}
}
