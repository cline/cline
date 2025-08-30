import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FILE_READ

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}})`,
			usage: "File path here",
		},
		{
			name: "task_progress",
			required: false,
			instruction: `A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)`,
			usage: "Checklist here (optional)",
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const read_file_variants = [generic, nextGen, gpt, gemini]
