/**
 * Converts a tool definition to ANTML (Anthropic Markup Language) format
 * as used internally by Claude for tool calling.
 *
 * Based on the Claude 4 System Card: https://www-cdn.anthropic.com/6be99a52cb68eb70eb9572b4cafad13df32ed995.pdf
 *
 * Tool definitions are provided in JSON schema within <functions> tags:
 * <functions>
 *   <function>{"description": "...", "name": "...", "parameters": {...}}</function>
 *   ... (other functions) ...
 * </functions>
 *
 * Tool calls are made using <antml:function_calls> blocks:
 * <antml:function_calls>
 *   <antml:invoke name="tool_name">
 *     <antml:parameter name="param_name">value</antml:parameter>
 *   </antml:invoke>
 * </antml:function_calls>
 */

export interface ToolDefinition {
	name: string
	description?: string
	descriptionForAgent?: string
	inputSchema: {
		type: string
		properties: Record<string, any>
		required?: string[]
		[key: string]: any
	}
}

/**
 * Converts a single tool definition (JSON schema) to the <function> tag format.
 * This is for *defining* the tool, not calling it.
 * @param toolDef The tool definition object
 * @returns The tool definition as a JSON string wrapped in <function> tags
 */
export function toolDefinitionToAntmlDefinition(toolDef: ToolDefinition): string {
	const functionDef = {
		name: toolDef.name,
		description: toolDef.descriptionForAgent || toolDef.description || "",
		parameters: toolDef.inputSchema,
	}
	const jsonString = JSON.stringify(functionDef)
	return `<function>${jsonString}</function>`
}

/**
 * Converts multiple tool definitions to the complete <functions> block.
 * This is for *defining* the tools.
 * @param toolDefs Array of tool definition objects
 * @returns Complete <functions> block with all tool definitions
 */
export function toolDefinitionsToAntmlDefinitions(toolDefs: ToolDefinition[]): string {
	const functionTags = toolDefs.map((toolDef) => toolDefinitionToAntmlDefinition(toolDef))
	return `Here are the functions available in JSONSchema format:
<functions>
  ${functionTags.join("\n  ")}
</functions>`
}

/**
 * Creates an example of an ANTML tool call for a given tool definition.
 * This is for *calling* a tool.
 * @param toolDef The tool definition object
 * @param exampleValues Optional example values for parameters
 * @returns Example ANTML function call string
 */
export function toolDefinitionToAntmlCallExample(toolDef: ToolDefinition, exampleValues: Record<string, any> = {}): string {
	const properties = toolDef.inputSchema.properties || {}
	let parametersXml = ""
	if (Object.keys(properties).length > 0) {
		parametersXml = Object.entries(properties)
			.map(([paramName]) => {
				const exampleValue = exampleValues[paramName] || `$${paramName.toUpperCase()}` // Use placeholder like $PARAMETER_NAME
				return `    <antml:parameter name="${paramName}">${exampleValue}</antml:parameter>`
			})
			.join("\n")
	} else {
		// Handle tools with no parameters
		parametersXml = "    <!-- This tool takes no parameters -->"
	}

	return `<antml:function_calls>
  <antml:invoke name="${toolDef.name}">
${parametersXml}
  </antml:invoke>
</antml:function_calls>`
}

/**
 * Creates a complete system prompt section for tools in ANTML format,
 * including instructions and tool definitions.
 * @param toolDefs Array of tool definition objects
 * @param includeInstructions Whether to include the standard tool calling instructions
 * @returns Complete system prompt section for ANTML tools
 */
export function createAntmlToolPrompt(toolDefs: ToolDefinition[], includeInstructions: boolean = true): string {
	if (toolDefs.length === 0 && includeInstructions) {
		// If no tools but instructions are requested, still provide basic instruction.
		return `In this environment you have access to a set of tools you can use to answer the user's question.
You can invoke functions by writing a "<antml:function_calls>" block as part of your reply.
However, no tools are currently available.`
	}
	if (toolDefs.length === 0) {
		return ""
	}

	let prompt = ""

	if (includeInstructions) {
		// Generate a generic example or use the first tool for a more concrete example
		const exampleToolCall =
			toolDefs.length > 0
				? toolDefinitionToAntmlCallExample(toolDefs[0])
				: `<antml:function_calls>
  <antml:invoke name="$FUNCTION_NAME">
    <antml:parameter name="$PARAMETER_NAME">$VALUE</antml:parameter>
  </antml:invoke>
</antml:function_calls>`

		prompt += `In this environment you have access to a set of tools you can use to answer the user's question.

You can invoke functions by writing a "<antml:function_calls>" block as part of your reply. For example:
${exampleToolCall}

String and scalar parameters should be specified as is, while lists and objects should use JSON format.
The output is not expected to be valid XML and is parsed with regular expressions.
DO NOT use antml unless you intend to invoke a tool.
`
	}

	prompt += toolDefinitionsToAntmlDefinitions(toolDefs)

	if (includeInstructions) {
		prompt += `

Answer the user's request using the relevant tool(s), if they are available. Check that all required parameters for each tool call are provided or can be reasonably inferred from context. If there are no relevant tools or there are missing values for required parameters, ask the user to supply these values; otherwise proceed with the tool calls.`
	}

	return prompt
}

// --- SimpleXML Functions (Cline's internal format) ---

/**
 * Converts a single tool definition to the SimpleXML format
 * as used by Cline's current system prompts for non-ANTML models.
 * @param toolDef The tool definition object
 * @returns The tool definition formatted for SimpleXML usage
 */
export function toolDefinitionToSimpleXml(toolDef: ToolDefinition): string {
	const description = toolDef.descriptionForAgent || toolDef.description || ""
	const properties = toolDef.inputSchema.properties || {}
	const required = toolDef.inputSchema.required || []

	let parameterDocs = ""
	if (Object.keys(properties).length > 0) {
		parameterDocs = "Parameters:\n"
		for (const [paramName, paramDef] of Object.entries(properties)) {
			const isRequired = required.includes(paramName)
			const requiredText = isRequired ? "(required)" : "(optional)"
			const paramDescription = (paramDef as any).description || "No description."
			parameterDocs += `- ${paramName}: ${requiredText} ${paramDescription}\n`
		}
	}

	const exampleParams = Object.keys(properties)
		.map((paramName) => `<${paramName}>${paramName} value here</${paramName}>`)
		.join("\n")

	const usageExample = `Usage:
<${toolDef.name}>
${exampleParams.length > 0 ? exampleParams + "\n" : ""}</${toolDef.name}>`

	return `## ${toolDef.name}
Description: ${description}
${parameterDocs.trim()}
${usageExample}`
}

/**
 * Converts multiple tool definitions to the complete SimpleXML format.
 * @param toolDefs Array of tool definition objects
 * @returns Complete tools documentation in SimpleXML format
 */
export function toolDefinitionsToSimpleXml(toolDefs: ToolDefinition[]): string {
	const toolDocs = toolDefs.map((toolDef) => toolDefinitionToSimpleXml(toolDef))
	return `# Tools

${toolDocs.join("\n\n")}`
}

/**
 * Creates a complete system prompt section for tools in SimpleXML format.
 * @param toolDefs Array of tool definition objects
 * @param includeInstructions Whether to include the standard tool calling instructions
 * @returns Complete system prompt section for SimpleXML tools
 */
export function createSimpleXmlToolPrompt(toolDefs: ToolDefinition[], includeInstructions: boolean = true): string {
	if (toolDefs.length === 0) {
		return ""
	}

	let prompt = ""

	if (includeInstructions) {
		prompt += `TOOL USE

You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:

<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>

For example:

<read_file>
<path>src/main.js</path>
</read_file>

Always adhere to this format for the tool use to ensure proper parsing and execution.
`
	}

	prompt += toolDefinitionsToSimpleXml(toolDefs)

	if (includeInstructions) {
		prompt += `

# Tool Use Guidelines

1. Choose the most appropriate tool based on the task and the tool descriptions provided.
2. If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively.
3. Formulate your tool use using the XML format specified for each tool.
4. After each tool use, the user will respond with the result of that tool use.
5. ALWAYS wait for user confirmation after each tool use before proceeding.`
	}
	return prompt
}
