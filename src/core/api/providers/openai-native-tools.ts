import type { FunctionTool } from "openai/resources/responses/responses"

export function getOpenAiResponsesTools(): FunctionTool[] {
	const tools: FunctionTool[] = [
		// File operations
		{
			type: "function",
			name: "read_file",
			description: "Read the contents of a file from the workspace.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Relative or absolute path to the file that should be read.",
					},
				},
				required: ["path"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "write_to_file",
			description:
				"Write content to a file at the specified path. Creates directories as needed; overwrites file if it exists.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path of the file to write (relative or absolute)." },
					content: { type: "string", description: "Complete file content to write." },
				},
				required: ["path", "content"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "replace_in_file",
			description: "Replace sections in a file using one or more SEARCH/REPLACE blocks following the specified format.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path of the file to modify (relative or absolute)." },
					diff: { type: "string", description: "One or more SEARCH/REPLACE blocks." },
				},
				required: ["path", "diff"],
				additionalProperties: false,
			},
			strict: true,
		},

		// Discovery and search
		{
			type: "function",
			name: "search_files",
			description: "Perform a regex search across files in a directory tree, returning context-rich matches.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory to search (recursive)." },
					regex: { type: "string", description: "Rust-compatible regular expression pattern." },
					file_pattern: {
						type: "string",
						description: "Optional glob pattern to filter files (e.g. '*.ts').",
					},
				},
				required: ["path", "regex"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "list_files",
			description: "List files and directories within the specified directory; optionally recurse into subdirectories.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory to list." },
					recursive: { type: "boolean", description: "List recursively when true." },
				},
				required: ["path"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "list_code_definition_names",
			description: "List top-level code definition names (classes, functions, methods, etc.) in a directory.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory to analyze." },
				},
				required: ["path"],
				additionalProperties: false,
			},
			strict: true,
		},

		// Terminal and planning
		{
			type: "function",
			name: "execute_command",
			description: "Execute a CLI command in the project root. Set requires_approval=true for impactful operations.",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Command to execute." },
					requires_approval: {
						type: "boolean",
						description: "Whether this command requires explicit user approval (for potentially impactful actions).",
					},
					timeout: {
						type: "integer",
						description: "Optional timeout in seconds for the command to run.",
					},
				},
				required: ["command", "requires_approval"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "plan_mode_respond",
			description:
				"Respond with a planning message in PLAN MODE. Use needs_more_exploration=true if more research is needed.",
			parameters: {
				type: "object",
				properties: {
					response: { type: "string", description: "Your planning response content." },
					needs_more_exploration: {
						type: "boolean",
						description: "Set true if additional exploration with tools is required next.",
					},
				},
				required: ["response"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "attempt_completion",
			description:
				"Present the final result to the user, optionally providing a demo command. Use only after confirmed success.",
			parameters: {
				type: "object",
				properties: {
					result: { type: "string", description: "Description of the final result." },
					command: {
						type: "string",
						description: "Optional CLI command to demonstrate the result (e.g. open a server or file).",
					},
				},
				required: ["result"],
				additionalProperties: false,
			},
			strict: false,
		},

		// Browser
		{
			type: "function",
			name: "browser_action",
			description: "Interact with a Puppeteer-controlled browser. Start with launch(url) and always end with close.",
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["launch", "click", "type", "scroll_down", "scroll_up", "close"],
						description: "Browser action to perform.",
					},
					url: { type: "string", description: "URL for the launch action." },
					coordinate: {
						type: "string",
						description: "x,y coordinates for click (within the current viewport).",
					},
					text: { type: "string", description: "Text to type for the type action." },
				},
				required: ["action"],
				additionalProperties: false,
			},
			strict: false,
		},

		// MCP
		{
			type: "function",
			name: "use_mcp_tool",
			description: "Use a tool provided by a connected MCP server. Provide the server name, tool name, and its arguments.",
			parameters: {
				type: "object",
				properties: {
					server_name: { type: "string", description: "Name of the MCP server." },
					tool_name: { type: "string", description: "Name of the MCP tool to execute." },
					arguments: {
						type: "object",
						description: "Input parameters for the MCP tool.",
						additionalProperties: true,
					},
				},
				required: ["server_name", "tool_name", "arguments"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "access_mcp_resource",
			description: "Access a resource provided by a connected MCP server.",
			parameters: {
				type: "object",
				properties: {
					server_name: { type: "string", description: "Name of the MCP server." },
					uri: { type: "string", description: "URI identifying the resource to access." },
				},
				required: ["server_name", "uri"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "load_mcp_documentation",
			description: "Load documentation about creating MCP servers.",
			parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
			strict: true,
		},

		// Task management and summarization
		{
			type: "function",
			name: "new_task",
			description: "Create a new task with preloaded context summarizing the conversation and key technical details.",
			parameters: {
				type: "object",
				properties: {
					context: { type: "string", description: "Context to preload the new task with." },
				},
				required: ["context"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "condense",
			description: "Create a detailed summary of the conversation so far to compact the context window.",
			parameters: {
				type: "object",
				properties: {
					context: { type: "string", description: "Detailed condensed summary to use going forward." },
				},
				required: ["context"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "summarize_task",
			description: "Generate a comprehensive task summary when the conversation is running out of context.",
			parameters: {
				type: "object",
				properties: {
					context: { type: "string", description: "Comprehensive summary of the conversation and state." },
				},
				required: ["context"],
				additionalProperties: false,
			},
			strict: true,
		},
		{
			type: "function",
			name: "report_bug",
			description: "Collect details and prepare a GitHub issue/bug report for the Cline repository.",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "Concise description of the issue." },
					what_happened: {
						type: "string",
						description: "What happened and what was expected to happen instead.",
					},
					steps_to_reproduce: { type: "string", description: "Steps to reproduce the bug." },
					api_request_output: {
						type: "string",
						description: "Relevant API request output (optional).",
					},
					additional_context: {
						type: "string",
						description: "Any other context not already mentioned (optional).",
					},
				},
				required: ["title", "what_happened", "steps_to_reproduce"],
				additionalProperties: false,
			},
			strict: false,
		},
		{
			type: "function",
			name: "new_rule",
			description: "Create a new Cline rule markdown file under the .clinerules directory with the provided content.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Path for the new rule file (must be under .clinerules and end with .md).",
					},
					content: {
						type: "string",
						description: "Complete markdown content of the new rule file.",
					},
				},
				required: ["path", "content"],
				additionalProperties: false,
			},
			strict: true,
		},

		// Conversation utilities
		{
			type: "function",
			name: "ask_followup_question",
			description: "Ask the user a question to gather additional information, optionally with multiple-choice options.",
			parameters: {
				type: "object",
				properties: {
					question: { type: "string", description: "The question to ask the user." },
					options: {
						type: "array",
						items: { type: "string" },
						description: "Optional list of 2-5 choices for the user.",
					},
				},
				required: ["question"],
				additionalProperties: false,
			},
			strict: false,
		},
	]

	return tools
}
