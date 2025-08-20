import { ModelFamily } from "@/shared/prompts"
import type { ClineToolSpec } from "./tools/spec"

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
}
