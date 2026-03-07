import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.WARPGREP

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "warpgrep_codebase_search",
	description:
		"Performs an AI-powered semantic codebase search using WarpGrep. Unlike search_files which uses regex patterns, this tool understands natural language queries and intelligently navigates the codebase across multiple turns to find relevant code. Use this tool when you need to understand how a feature works, find where something is implemented, or explore unfamiliar code. Use search_files instead when you know the exact pattern or string to search for.",
	contextRequirements: (context) => context.warpGrepEnabled === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction:
				"A natural language description of what you're looking for in the codebase. Be specific and descriptive.",
			usage: "Find where user authentication is implemented",
		},
	],
}

export const warpgrep_codebase_search_variants = [GENERIC]
