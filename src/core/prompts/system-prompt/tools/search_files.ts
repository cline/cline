import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## search_files
Description: Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.
Parameters:
- path: (required) The path of the directory to search in (relative to the current working directory ${cwd.toPosix()}). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
Usage:
<search_files>
<path>Directory path here</path>
<regex>Your regex pattern here</regex>
<file_pattern>file pattern here (optional)</file_pattern>
</search_files>
 */

const id = ClineDefaultTool.SEARCH

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "search_files",
	description:
		"Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the directory to search in (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. This directory will be recursively searched.`,
			usage: "Directory path here",
		},
		{
			name: "regex",
			required: true,
			instruction: "The regular expression pattern to search for. Uses Rust regex syntax.",
			usage: "Your regex pattern here",
		},
		{
			name: "file_pattern",
			required: false,
			instruction:
				"Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
			usage: "file pattern here (optional)",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "search_files",
	description:
		"Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the directory to search in (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. This directory will be recursively searched.`,
			usage: "Directory path here",
		},
		{
			name: "regex",
			required: true,
			instruction: "The regular expression pattern to search for. Uses Rust regex syntax.",
			usage: "Your regex pattern here",
		},
		{
			name: "file_pattern",
			required: false,
			instruction:
				"Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
			usage: "file pattern here (optional)",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const search_files_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
