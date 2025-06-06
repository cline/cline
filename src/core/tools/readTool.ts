const DEFAULT_LINE_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

const descriptionForAgent = `Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.`

export const readToolDefinition = (cwd: string) => ({
	name: "Read",
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: `The path of the file to read (relative to the current working directory ${cwd.toPosix()})`,
			},
		},
		required: ["file_path"],
	},
})
