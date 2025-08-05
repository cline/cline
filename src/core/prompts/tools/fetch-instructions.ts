/**
 * Generates the fetch_instructions tool description.
 * @param enableMcpServerCreation - Whether to include MCP server creation task.
 *                                  Defaults to true when undefined.
 */
export function getFetchInstructionsDescription(enableMcpServerCreation?: boolean): string {
	const tasks =
		enableMcpServerCreation !== false
			? `  create_mcp_server
  create_mode`
			: `  create_mode`

	const example =
		enableMcpServerCreation !== false
			? `Example: Requesting instructions to create an MCP Server

<fetch_instructions>
<task>create_mcp_server</task>
</fetch_instructions>`
			: `Example: Requesting instructions to create a Mode

<fetch_instructions>
<task>create_mode</task>
</fetch_instructions>`

	return `## fetch_instructions
Description: Request to fetch instructions to perform a task
Parameters:
- task: (required) The task to get instructions for.  This can take the following values:
${tasks}

${example}`
}
