const descriptionForAgent = `Request to list definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.`

export const listCodeDefinitionNamesToolDefinition = (cwd: string) => ({
	name: "ListCodeDefinitionNames",
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: `The path of the directory (relative to the current working directory ${cwd.toPosix()}) to list top level source code definitions for.`,
			},
		},
		required: ["path"],
	},
})
