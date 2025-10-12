import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getCliSubagentsTemplateText = (context: SystemPromptContext) => `USING THE CLINE CLI TOOL

The Cline CLI tool is installed and available for spawning subprocesses to handle focused tasks. This keeps your main context clean by delegating information-gathering and exploration to separate Cline instances. Use this when you need to research large codebases, explore file structures, gather information from multiple files, analyze dependencies, or summarize code sections without loading everything into your context.

## Command Syntax

\`\`\`bash
cline "your prompt here" [options]

Options:
  --workdir <directory>    # Specify working directory (defaults to current)
  --no-interactive         # Prevents all interactivity (always use this for subprocesses)
\`\`\`

## Examples

\`\`\`bash
# Find specific patterns
cline "find all React components that use the useState hook and list their names" --no-interactive

# Analyze code structure
cline "analyze the authentication flow and provide a summary" --workdir ./src/auth --no-interactive

# Gather targeted information
cline "list all API endpoints and their HTTP methods" --workdir ./backend --no-interactive

# Summarize directories
cline "summarize the purpose of all files in the src/services directory" --no-interactive

# Research implementations
cline "find how error handling is implemented across the application" --no-interactive
\`\`\`

## Tips

- Be specific with your instructions to get focused results
- Request summaries rather than full file contents
- Always use --no-interactive to prevent blocking
- Use --workdir to target specific directories and narrow scope
- When it makes sense to do so, use cline CLI subprocesses for exploration before loading specific files into your main context`

export async function getCliSubagentsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	// Only include this section if CLI is installed and subagents are enabled
	if (!context.isSubagentsEnabledAndCliInstalled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.CLI_SUBAGENTS]?.template || getCliSubagentsTemplateText

	return new TemplateEngine().resolve(template, context, {})
}
