import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = AiHydroDefaultTool.FILE_READ

const generic: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files. By default, reads the first 1000 lines of a file. Use start_line and end_line to read specific ranges, especially for large files.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		{
			name: "start_line",
			required: false,
			instruction:
				"The 1-indexed line number to start reading from. If not provided, reading starts from line 1. Use this to read specific sections of large files.",
			usage: "1",
		},
		{
			name: "end_line",
			required: false,
			instruction:
				"The 1-indexed line number to stop reading at (inclusive). If not provided, reads up to 1000 lines from start_line. Use this with start_line to read specific ranges.",
			usage: "100",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const read_file_variants = [generic, nextGen, gpt, gemini]
