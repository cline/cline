import { CLINE_MCP_TOOL_IDENTIFIER, McpServer } from "@/shared/mcp"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
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

	/**
	 * Get the appropriate native tool converter for the given provider
	 */
	public static getNativeConverter(providerId: string, modelId?: string) {
		switch (providerId) {
			case "minimax":
			case "anthropic":
				return toolSpecInputSchema
			case "gemini":
				return toolSpecFunctionDeclarations
			case "vertex":
				if (modelId?.includes("gemini")) {
					return toolSpecFunctionDeclarations
				}
				return toolSpecInputSchema
			default:
				// Default to OpenAI Compatible converter
				return toolSpecFunctionDefinition
		}
	}

	public static getNativeTools(variant: PromptVariant, context: SystemPromptContext) {
		// Only return tool functions if the variant explicitly enables them
		// via the "use_native_tools" label set to 1
		// This avoids exposing tools to models that don't support them
		// or variants that aren't designed for tool use
		if (variant.labels["use_native_tools"] !== 1 || !context.enableNativeToolCalls) {
			return undefined
		}

		// Base set
		const toolsets = ClineToolSet.getEnabledTools(variant, context)
		const toolConfigs = toolsets.map((tool) => tool.config)

		// MCP tools
		const mcpServers = context.mcpHub?.getServers()?.filter((s) => s.disabled !== true) || []
		const mcpTools = mcpServers?.flatMap((server) => mcpToolToClineToolSpec(variant.family, server))

		const enabledTools = [...toolConfigs, ...mcpTools]
		const converter = ClineToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)

		return enabledTools.map((tool) => converter(tool, context))
	}
}

/**
 * Convert an MCP server's tools to ClineToolSpec format
 */
export function mcpToolToClineToolSpec(family: ModelFamily, server: McpServer): ClineToolSpec[] {
	const tools = server.tools || []
	return tools
		.map((mcpTool) => {
			let parameters: any[] = []

			if (mcpTool.inputSchema && "properties" in mcpTool.inputSchema) {
				const schema = mcpTool.inputSchema as any
				const requiredFields = new Set(schema.required || [])

				parameters = Object.entries(schema.properties as Record<string, any>).map(([name, propSchema]) => {
					// Preserve the full schema, not just basic fields
					const param: any = {
						name,
						instruction: propSchema.description || "",
						type: propSchema.type || "string",
						required: requiredFields.has(name),
					}

					// Preserve items for array types
					if (propSchema.items) {
						param.items = propSchema.items
					}

					// Preserve properties for object types
					if (propSchema.properties) {
						param.properties = propSchema.properties
					}

					// Preserve other JSON Schema fields (enum, format, minimum, maximum, etc.)
					for (const key in propSchema) {
						if (!["type", "description", "items", "properties"].includes(key)) {
							param[key] = propSchema[key]
						}
					}

					return param
				})
			}

			const mcpToolName = server.uid + CLINE_MCP_TOOL_IDENTIFIER + mcpTool.name

			// NOTE: When the name is too long, the provider API will reject the tool registration with the following error:
			// `Invalid 'tools[n].name': string too long. Expected a string with maximum length 64, but got a string with length n instead.`
			// To avoid this, we skip registering tools with names that are too long.
			if (mcpToolName?.length <= 64) {
				return {
					variant: family,
					id: ClineDefaultTool.MCP_USE,
					// We will use the identifier to reconstruct the MCP server and tool name later
					name: mcpToolName,
					description: `${server.name}: ${mcpTool.description || mcpTool.name}`,
					parameters,
				}
			}

			return undefined
		})
		.filter((t) => t !== undefined)
}
