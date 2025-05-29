const DEFAULT_LINE_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

const descriptionForAgent = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_LINE_LIMIT} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than ${MAX_LINE_LENGTH} characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Cline to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Cline is a multimodal LLM.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful. 
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/Temporary_Screenshots/2026-09-08/Screenshot.png
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`

export const readToolDefinition = {
	name: "Read",
	descriptionForAgent: descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: "The absolute path to the file to read",
			},
			offset: {
				type: "number",
				description: "The line number to start reading from. Only provide if the file is too large to read at once",
				optional: true,
			},
			limit: {
				type: "number",
				description: "The number of lines to read. Only provide if the file is too large to read at once.",
				optional: true,
			},
		},
		required: ["file_path"],
	},
}
