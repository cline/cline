import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = AiHydroDefaultTool.MULTI_FILE_EDIT

const generic: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "edit_files",
	description:
		"Request to apply SEARCH/REPLACE edits to MULTIPLE files in a single tool call. Use this instead of calling replace_in_file repeatedly when the same task touches several files (e.g. renaming a class across many files, injecting a banner into every page). Each file is opened in its own diff view and approved individually, but they are all processed from one tool call, which is far more efficient than one round-trip per file. Prefer this (or replace_in_file) over writing shell/python scripts to edit files.",
	parameters: [
		{
			name: "edits",
			required: true,
			instruction: `One or more per-file edit blocks. Begin each file's block with a marker line of EXACTLY this form (seven '>' characters):

  >>>>>>> FILE: relative/path/to/file
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE

Then, for the next file, start a new ">>>>>>> FILE: ..." marker. Within each file block you may include multiple SEARCH/REPLACE blocks. The SEARCH/REPLACE rules are identical to replace_in_file:
  1. SEARCH content must match the file EXACTLY (character-for-character, including whitespace and indentation).
  2. Each SEARCH/REPLACE block replaces only the first occurrence; list multiple blocks in the order they appear in the file.
  3. Keep blocks concise — include just the changing lines plus a few surrounding lines for uniqueness.
  4. To delete code, use an empty REPLACE section.
File paths are relative to the current working directory {{CWD}}.`,
			usage: `>>>>>>> FILE: path/to/first.file
------- SEARCH
old content
=======
new content
+++++++ REPLACE
>>>>>>> FILE: path/to/second.file
------- SEARCH
old content
=======
new content
+++++++ REPLACE`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const edit_files_variants = [generic, nextGen, gpt, gemini]
