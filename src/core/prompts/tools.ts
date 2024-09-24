import { Tool } from "../../shared/Tool"

export const tools = (cwd: string, supportsImages: boolean): Tool[] => [
	{
		name: "execute_command",
		description: `Execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: ${cwd.toPosix()}`,
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
				},
			},
			required: ["command"],
		},
	},
	{
		name: "read_file",
		description:
			"Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the file to read (relative to the current working directory ${cwd.toPosix()})`,
				},
			},
			required: ["path"],
		},
	},
	{
		name: "write_to_file",
		description:
			"Write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. Always provide the full intended content of the file, without any truncation. This tool will automatically create any directories needed to write the file.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the file to write to (relative to the current working directory ${cwd.toPosix()})`,
				},
				content: {
					type: "string",
					description: "The full content to write to the file.",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "search_files",
		description:
			"Perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to search in (relative to the current working directory ${cwd.toPosix()}). This directory will be recursively searched.`,
				},
				regex: {
					type: "string",
					description: "The regular expression pattern to search for. Uses Rust regex syntax.",
				},
				filePattern: {
					type: "string",
					description:
						"Optional glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
				},
			},
			required: ["path", "regex"],
		},
	},
	{
		name: "list_files",
		description:
			"List files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to list contents for (relative to the current working directory ${cwd.toPosix()})`,
				},
				recursive: {
					type: "string",
					enum: ["true", "false"],
					description:
						"Whether to list files recursively. Use 'true' for recursive listing, 'false' or omit for top-level only.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "list_code_definition_names",
		description:
			"Lists definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory (relative to the current working directory ${cwd.toPosix()}) to list top level source code definitions for`,
				},
			},
			required: ["path"],
		},
	},
	...(supportsImages
		? [
				{
					name: "inspect_site",
					description:
						"Captures a screenshot and console logs of the initial state of a website. This tool navigates to the specified URL, takes a screenshot of the entire page as it appears immediately after loading, and collects any console logs or errors that occur during page load. It does not interact with the page or capture any state changes after the initial load.",
					input_schema: {
						type: "object",
						properties: {
							url: {
								type: "string",
								description:
									"The URL of the site to inspect. This should be a valid URL including the protocol (e.g. http://localhost:3000/page, file:///path/to/file.html, etc.)",
							},
						},
						required: ["url"],
					},
				} satisfies Tool,
		  ]
		: []),
	{
		name: "ask_followup_question",
		description:
			"Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.",
		input_schema: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description:
						"The question to ask the user. This should be a clear, specific question that addresses the information you need.",
				},
			},
			required: ["question"],
		},
	},
	{
		name: "attempt_completion",
		description:
			"Once you've completed the task, use this tool to present the result to the user. Optionally you may provide a CLI command to showcase the result of your work, but avoid using commands like 'echo' or 'cat' that merely print text. They may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.",
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"A CLI command to execute to show a live demo of the result to the user. For example, use 'open index.html' to display a created website. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
				},
				result: {
					type: "string",
					description:
						"The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.",
				},
			},
			required: ["result"],
		},
	},
]
