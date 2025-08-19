import { STANDARD_PLACEHOLDERS } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { extractModelFamily } from "./utils"

export class PromptBuilder {
	private templateEngine: TemplateEngine

	constructor(
		private variant: PromptVariant,
		private context: SystemPromptContext,
		private components: ComponentRegistry,
	) {
		this.templateEngine = new TemplateEngine()
	}

	async build(): Promise<string> {
		// 1. Build all components in specified order
		const componentSections = await this.buildComponents()

		// 2. Prepare all placeholder values
		const placeholderValues = await this.preparePlaceholders(componentSections)

		// 3. Resolve template placeholders
		let prompt = this.templateEngine.resolve(this.variant.baseTemplate, placeholderValues)

		// 4. Apply final processing
		prompt = this.postProcess(prompt)

		return prompt
	}

	private async buildComponents(): Promise<Record<string, string>> {
		const sections: Record<string, string> = {}

		for (const componentId of this.variant.componentOrder) {
			const componentFn = this.components[componentId]
			if (componentFn) {
				try {
					const result = await componentFn(this.variant, this.context)
					if (result?.trim()) {
						sections[componentId] = result
					}
				} catch (error) {
					console.warn(`Warning: Failed to build component '${componentId}':`, error)
				}
			} else {
				console.warn(`Warning: Component '${componentId}' not found`)
			}
		}

		return sections
	}

	private async preparePlaceholders(componentSections: Record<string, string>): Promise<Record<string, unknown>> {
		const placeholders: Record<string, unknown> = {
			// Base variant placeholders
			...this.variant.placeholders,

			// Component sections
			...componentSections,

			// Standard system placeholders
			[STANDARD_PLACEHOLDERS.CWD]: this.context.cwd || process.cwd(),
			[STANDARD_PLACEHOLDERS.SUPPORTS_BROWSER]: this.context.supportsBrowserUse || false,
			[STANDARD_PLACEHOLDERS.MODEL_FAMILY]: extractModelFamily(this.variant.id),
			[STANDARD_PLACEHOLDERS.CURRENT_DATE]: new Date().toISOString().split("T")[0],

			// Map component sections to standard placeholders
			[STANDARD_PLACEHOLDERS.SYSTEM_INFO]: componentSections.system_info || "",
			[STANDARD_PLACEHOLDERS.MCP_SECTION]: componentSections.mcp || "",
			[STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS]: componentSections.user_instructions || "",
			[STANDARD_PLACEHOLDERS.TODO_SECTION]: componentSections.todo || "",
			[STANDARD_PLACEHOLDERS.TOOL_USE]: componentSections.tool_use || "",
			[STANDARD_PLACEHOLDERS.EDITING_FILES]: componentSections.editing_files || "",
			[STANDARD_PLACEHOLDERS.CAPABILITIES]: componentSections.capabilities || "",
			[STANDARD_PLACEHOLDERS.FEEDBACK]: componentSections.feedback || "",
			[STANDARD_PLACEHOLDERS.RULES]: componentSections.rules || "",
			[STANDARD_PLACEHOLDERS.OBJECTIVE]: componentSections.objective || "",
			[STANDARD_PLACEHOLDERS.ACT_VS_PLAN_MODE]: componentSections.act_vs_plan_mode || "",

			// Runtime placeholders from context (highest priority)
			...((this.context as any).runtimePlaceholders || {}),
		}

		return placeholders
	}

	private postProcess(prompt: string): string {
		// Remove multiple consecutive empty lines
		prompt = prompt.replace(/\n\s*\n\s*\n/g, "\n\n")

		// Remove leading/trailing whitespace
		prompt = prompt.trim()

		// Ensure proper section separation
		prompt = prompt.replace(/====\n([^\n])/g, "====\n\n$1")
		prompt = prompt.replace(/([^\n])\n====/g, "$1\n\n====")

		return prompt
	}

	/**
	 * Get metadata about the build process (useful for debugging)
	 */
	getBuildMetadata(): {
		variantId: string
		version: number
		componentsUsed: string[]
		placeholdersResolved: string[]
	} {
		return {
			variantId: this.variant.id,
			version: this.variant.version,
			componentsUsed: this.variant.componentOrder,
			placeholdersResolved: this.templateEngine.extractPlaceholders(this.variant.baseTemplate),
		}
	}
}
