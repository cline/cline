import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_EDIT

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "replace_in_file",
	description:
		"Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a file.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to modify (relative to the current working directory {{CWD}})`,
			usage: "File path here",
		},
		{
			name: "diff",
			required: true,
			instruction: `One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section`,
			usage: "Search and replace blocks here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "replace_in_file",
	description:
		"[IMPORTANT: Always output the absolutePath first] Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a file.",
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction: "The absolute path to the file to write to.",
		},
		{
			name: "diff",
			required: true,
			instruction: `One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
	 * Match character-for-character including whitespace, indentation, line endings
	 * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
	 * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
	 * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
	 * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
	 * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
	 * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
	 * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
	 * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
	 * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
	 * To delete code: Use empty REPLACE section`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const replace_in_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
