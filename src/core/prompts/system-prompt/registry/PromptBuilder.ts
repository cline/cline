import type { ModelFamily } from "@/shared/prompts"
import type { ClineDefaultTool } from "@/shared/tools"
import { ClineToolSet } from "../../ClineToolSet"
import { STANDARD_PLACEHOLDERS } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { ClineToolSpec } from "../tools/spec"
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
		const prompt = this.templateEngine.resolve(this.variant.baseTemplate, placeholderValues)
		// 4. Apply final processing
		return this.postProcess(prompt)
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

			// Standard system placeholders
			[STANDARD_PLACEHOLDERS.CWD]: this.context.cwd || process.cwd(),
			[STANDARD_PLACEHOLDERS.SUPPORTS_BROWSER]: this.context.supportsBrowserUse || false,
			[STANDARD_PLACEHOLDERS.MODEL_FAMILY]: extractModelFamily(this.variant.id),
			[STANDARD_PLACEHOLDERS.CURRENT_DATE]: new Date().toISOString().split("T")[0],

			// Component sections
			...componentSections,

			// Map component sections to standard placeholders
			[STANDARD_PLACEHOLDERS.AGENT_ROLE]: componentSections[STANDARD_PLACEHOLDERS.AGENT_ROLE] || "",
			[STANDARD_PLACEHOLDERS.TOOL_USE]: componentSections[STANDARD_PLACEHOLDERS.TOOL_USE] || "",
			[STANDARD_PLACEHOLDERS.TOOLS]: componentSections[STANDARD_PLACEHOLDERS.TOOLS] || "",
			[STANDARD_PLACEHOLDERS.MCP]: componentSections[STANDARD_PLACEHOLDERS.MCP] || "",
			[STANDARD_PLACEHOLDERS.EDITING_FILES]: componentSections[STANDARD_PLACEHOLDERS.EDITING_FILES] || "",
			[STANDARD_PLACEHOLDERS.SYSTEM_INFO]: componentSections[STANDARD_PLACEHOLDERS.SYSTEM_INFO] || "",
			[STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS]: componentSections[STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS] || "",
			[STANDARD_PLACEHOLDERS.TODO]: componentSections[STANDARD_PLACEHOLDERS.TODO] || "",
			[STANDARD_PLACEHOLDERS.CAPABILITIES]: componentSections[STANDARD_PLACEHOLDERS.CAPABILITIES] || "",
			[STANDARD_PLACEHOLDERS.FEEDBACK]: componentSections[STANDARD_PLACEHOLDERS.FEEDBACK] || "",
			[STANDARD_PLACEHOLDERS.RULES]: componentSections[STANDARD_PLACEHOLDERS.RULES] || "",
			[STANDARD_PLACEHOLDERS.OBJECTIVE]: componentSections[STANDARD_PLACEHOLDERS.OBJECTIVE] || "",
			[STANDARD_PLACEHOLDERS.ACT_VS_PLAN]: componentSections[STANDARD_PLACEHOLDERS.ACT_VS_PLAN] || "",

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

	public static async getToolsPrompts(variant: PromptVariant, context: SystemPromptContext) {
		const tools = ClineToolSet.getTools(variant.family)

		// Filter tools based on context requirements
		const enabledTools = tools.filter((tool) => {
			if (tool.config.contextRequirements) {
				return tool.config.contextRequirements(context)
			}
			// If no context requirements, tool is always enabled
			return true
		})

		// Sort tools based on variant's tool order if available
		let sortedEnabledTools = enabledTools
		if (variant?.tools && variant.tools.length > 0) {
			// Create a map for quick lookup of tool order
			const toolOrderMap = new Map<string, number>()
			variant.tools.forEach((toolId, index) => {
				toolOrderMap.set(toolId, index)
			})

			// Sort enabled tools based on the order specified in variant.tools
			sortedEnabledTools = enabledTools.sort((a, b) => {
				const orderA = toolOrderMap.get(a.config.id)
				const orderB = toolOrderMap.get(b.config.id)

				// If both tools are in the variant's tools array, sort by their order
				if (orderA !== undefined && orderB !== undefined) {
					return orderA - orderB
				}
				// If only one tool is in the variant's tools array, prioritize it
				if (orderA !== undefined) {
					return -1
				}
				if (orderB !== undefined) {
					return 1
				}
				// If neither tool is in the variant's tools array, maintain original order
				return 0
			})
		} else {
			// Fallback: Sort tools by id to ensure consistent output in test
			sortedEnabledTools = enabledTools.sort((a, b) => a.config.id.localeCompare(b.config.id))
		}

		const ids = sortedEnabledTools.map((tool) => tool.config.id)
		const toolPrompts = await Promise.all(sortedEnabledTools.map((t) => PromptBuilder.tool(t.config, ids)))
		return toolPrompts
	}

	public static tool(config: ClineToolSpec, registry: ClineDefaultTool[]): string {
		const title = `## ${config.id}`
		const promptSections = [title]
		const description = [`Description: ${config.description}`]

		if (config.parameters?.length) {
			const _params = [...config.parameters]

			// Collect additional descriptions from ALL parameters (regardless of filtering)
			const additionalDesc: string[] = _params.map((p) => p.description).filter((d) => d !== undefined)
			if (additionalDesc.length > 0) {
				description.push(...additionalDesc)
			}

			// Filter parameters based on dependencies
			// Keep parameters that either have no dependencies OR have all dependencies satisfied
			const params = _params.filter((p) => {
				if (!p.dependencies || p.dependencies.length === 0) {
					// No dependencies, include the parameter
					return true
				}
				// Has dependencies, check if all are satisfied (present in registry)
				return p.dependencies.every((d) => registry.includes(d))
			})

			promptSections.push(description.join("\n"))

			// Build Parameters section
			const paramsSection = ["Parameters:"]
			const paramsList = params.map((p) => {
				const requiredText = p.required ? "required" : "optional"
				const instruction = p.instruction
				return `- ${p.name}: (${requiredText}) ${instruction}`
			})
			paramsSection.push(...paramsList)
			promptSections.push(paramsSection.join("\n"))

			// Build Usage section
			const usageSection = ["Usage:"]
			const usageTag = `<${config.id}>`
			const usageEndTag = `</${config.id}>`
			const usageParams = params.map((p) => {
				const usage = p.usage || ""
				return `<${p.name}>${usage}</${p.name}>`
			})

			usageSection.push(usageTag)
			usageSection.push(...usageParams)
			usageSection.push(usageEndTag)
			promptSections.push(usageSection.join("\n"))
		} else {
			// No parameters, just add the description
			promptSections.push(description.join("\n"))
		}

		return promptSections.join("\n")
	}
}
