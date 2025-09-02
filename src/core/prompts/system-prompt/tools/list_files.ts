import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.LIST_FILES

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "list_files",
	description:
		"Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: "The path of the directory to list contents for (relative to the current working directory {{CWD}})",
			usage: "Directory path here",
		},
		{
			name: "recursive",
			required: false,
			instruction: "Whether to list files recursively. Use true for recursive listing, false or omit for top-level only.",
			usage: "true or false (optional)",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const list_files_variants = [generic]
