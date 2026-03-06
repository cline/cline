import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_READ

const READ_FILE_DESCRIPTION =
	"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Returned text lines are prefixed with line labels (e.g. `L1:`, `L2:`). These labels are metadata, not part of the file content. For large files, output is automatically limited to 1000 lines. Use start_line and end_line to read specific sections. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string."

const READ_FILE_PARAMETERS: ClineToolSpec["parameters"] = [
	{
		name: "path",
		required: true,
		instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
		usage: "File path here",
	},
	{
		name: "start_line",
		required: false,
		type: "integer",
		instruction: "The 1-based line number to start reading from (inclusive). Defaults to 1.",
		usage: "1",
	},
	{
		name: "end_line",
		required: false,
		type: "integer",
		instruction:
			"The 1-based line number to stop reading at (inclusive). Defaults to start_line + 1000. Use with start_line to read specific sections of large files.",
		usage: "1000",
	},
	TASK_PROGRESS_PARAMETER,
]

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description: READ_FILE_DESCRIPTION,
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_file",
	description: READ_FILE_DESCRIPTION,
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
