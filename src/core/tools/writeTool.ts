const descriptionForAgent = (
	cwd: string,
) => `Request to write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.

Usage:
- The file_path parameter must be an relative path to the current working directory: ${cwd.toPosix()}
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.`

export const writeToolDefinition = (cwd: string) => ({
	name: "Write",
	descriptionForAgent: descriptionForAgent(cwd),
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: `The path of the file to write to (relative to the current working directory ${cwd.toPosix()})`,
			},
			content: {
				type: "string",
				description:
					"The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified.",
			},
		},
		required: ["file_path", "content"],
	},
})
