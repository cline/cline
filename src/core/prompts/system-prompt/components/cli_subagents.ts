import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getCliSubagentsTemplateText = (_context: SystemPromptContext) => `USING THE CLINE CLI TOOL

The Cline CLI tool can be used to assign Cline AI agents with focused tasks. This can be used to keep you focused by delegating information-gathering and exploration to separate Cline instances. Use the Cline CLI tool to research large codebases, explore file structures, gather information from multiple files, analyze dependencies, or summarize code sections when the complete context may be too large or overwhelming.

## Command Syntax

\`\`\`bash
cline "your prompt here" --no-interactive

Options:
  --no-interactive         # Must be used at all times
\`\`\`

## Examples of how you might use this tool

\`\`\`bash
# Find specific patterns
cline "find all React components that use the useState hook and list their names" --no-interactive

# Analyze code structure
cline "analyze the authentication flow. Reverse trace through all relevant functions and methods, and provide a summary of how it works. Include file/class references in your summary." --workdir ./src/auth --no-interactive

# Gather targeted information
cline "list all API endpoints and their HTTP methods" --workdir ./backend --no-interactive

# Summarize directories
cline "summarize the purpose of all files in the src/services directory" --no-interactive

# Research implementations
cline "find how error handling is implemented across the application" --no-interactive
\`\`\`

## Tips

- Always use --no-interactive with every Cline CLI Agent request.
- Be specific with your instructions to get focused results.
- Request summaries rather than full file contents. Encourege the agent to be brief, but specific and technically dense with their response.
- If files you want to read are large or complicated, use Cline CLI agents for exploration before instead of reading these files.`

export async function getCliSubagentsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	// Only include this section if CLI is installed and subagents are enabled
	if (!context.isSubagentsEnabledAndCliInstalled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.CLI_SUBAGENTS]?.template || getCliSubagentsTemplateText

	return new TemplateEngine().resolve(template, context, {})
}
