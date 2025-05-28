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

function escapeXml(text: string): string {
	// Anything that could be interpreted as markup has to be entity-encoded
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

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

	// 1.  Build JSON
	const rawJson = JSON.stringify(functionDef)

	// 2.  Escape <, > and & so the JSON can sit INSIDE the XML tag safely.
	//     (Quotes don’t need escaping - they’re not markup.)
	const safeJson = escapeXml(rawJson)

	// 3.  Return wrapped in <function> tags
	return `<function>${safeJson}</function>`
}

/**
 * Converts multiple tool definitions to the complete <functions> block.
 * This is for *defining* the tools.
 * @param toolDefs Array of tool definition objects
 * @returns Complete <functions> block with all tool definitions
 */
export function toolDefinitionsToAntmlDefinitions(
	toolDefs: ToolDefinition[],
): string {
	const functionTags = toolDefs.map(toolDefinitionToAntmlDefinition);
	return `Here are the functions available in JSONSchema format:
<functions>
${functionTags.join('\n')}
</functions>`;
}



/**
 * Creates an example of an ANTML tool call for a given tool definition.
 * This is for *calling* a tool.
 * @param toolDef The tool definition object
 * @param exampleValues Optional example values for parameters
 * @returns Example ANTML function call string
 */
export function toolDefinitionToAntmlCallExample(
  toolDef: ToolDefinition,
  exampleValues: Record<string, any> = {},
): string {
  const props = toolDef.inputSchema.properties ?? {};

  const paramLines = Object.keys(props).length
    ? Object.entries(props)
        .map(([name]) => {
          const value = exampleValues[name] ?? `$${name.toUpperCase()}`; // placeholder
          // Don't escape XML here - the example should show raw format
          return `<parameter name="${name}">${value}</parameter>`;
        })
        .join('\n')
    : '';

  // Include the dots to show multiple invokes can be used
  return [
    '<function_calls>',
    `<invoke name="${toolDef.name}">`,
    paramLines,
    '</invoke>',
    '<invoke name="$FUNCTION_NAME2">',
    '...',
    '</invoke>',
    '</function_calls>'
  ].filter(Boolean).join('\n');
}

/**
 * Creates a complete system prompt section for tools in ANTML format,
 * including instructions and tool definitions.
 * @param toolDefs Array of tool definition objects
 * @param includeInstructions Whether to include the standard tool calling instructions
 * @returns Complete system prompt section for ANTML tools
 */
export function createAntmlToolPrompt(
  toolDefs: ToolDefinition[],
  includeInstructions = true,
  systemPrompt = '',
): string {
  if (toolDefs.length === 0) {
    if (!includeInstructions) return '';
    
    const noToolsMessage = [
      'In this environment you have access to a set of tools you can use to answer the user\'s question.',
      'You can invoke functions by writing a "<function_calls>" block like the following as part of your reply to the user:',
      '<function_calls>',
      '<invoke name="$FUNCTION_NAME">',
      '<parameter name="$PARAMETER_NAME">$PARAMETER_VALUE</parameter>',
      '...',
      '</invoke>',
      '<invoke name="$FUNCTION_NAME2">',
      '...',
      '</invoke>',
      '</function_calls>',
      '',
      'String and scalar parameters should be specified as is, while lists and objects should use JSON format.',
      '',
      'However, no tools are currently available.'
    ].join('\n');
    
    return noToolsMessage;
  }

  let prompt = '';

  if (includeInstructions) {
    const instructionLines = [
      'In this environment you have access to a set of tools you can use to answer the user\'s question.',
      'You can invoke functions by writing a "<function_calls>" block like the following as part of your reply to the user:',
      '<function_calls>',
      '<invoke name="$FUNCTION_NAME">',
      '<parameter name="$PARAMETER_NAME">$PARAMETER_VALUE</parameter>',
      '...',
      '</invoke>',
      '<invoke name="$FUNCTION_NAME2">',
      '...',
      '</invoke>',
      '</function_calls>',
      '',
      'String and scalar parameters should be specified as is, while lists and objects should use JSON format.',
      ''
    ];
    prompt += instructionLines.join('\n');
  }

  prompt += toolDefinitionsToAntmlDefinitions(toolDefs);

  if (includeInstructions) {
    const closingInstructions = [
	  '',
	  '',
	  systemPrompt,
      '',
      '',
      'Answer the user\'s request using the relevant tool(s), if they are available. Check that all the required parameters for each tool call are provided or can reasonably be inferred from context. IF there are no relevant tools or there are missing values for required parameters, ask the user to supply these values; otherwise proceed with the tool calls. If the user provides a specific value for a parameter (for example provided in quotes), make sure to use that value EXACTLY. DO NOT make up values for or ask about optional parameters. Carefully analyze descriptive terms in the request as they may indicate required parameter values that should be included even if not explicitly quoted.'
    ];
    prompt += closingInstructions.join('\n');
  }

  return prompt;  // Don't trim - preserve exact formatting
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
	return prompt.trimEnd();
}
