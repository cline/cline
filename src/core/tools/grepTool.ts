import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const grepToolDefinition: ToolDefinition = {
	name: "Grep",
	descriptionForAgent: `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\\\s+\\\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths with at least one match
- Use this tool when you need to find files containing specific patterns`,
	inputSchema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "The regular expression pattern to search for in file contents",
			},
			path: {
				type: "string",
				description: "The directory to search in.",
			},
			include: {
				type: "string",
				description: "File pattern to filter which files to search (e.g., '*.js' for JavaScript files)",
			},
		},
		required: ["pattern", "path"],
	},
}
