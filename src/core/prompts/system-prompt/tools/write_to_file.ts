import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_NEW

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "write_to_file",
	description:
		"Request to write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to write to (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		{
			name: "content",
			required: true,
			instruction:
				"The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified.",
			usage: "Your file content here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const write_to_file_variants = [generic, nextGen, gpt, gemini]
