import { ModelFamily } from "@/shared/prompts"
import type { ClineToolSpec } from "../spec"

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
}
