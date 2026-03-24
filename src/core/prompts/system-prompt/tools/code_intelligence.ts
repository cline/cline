import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.CODE_INTELLIGENCE

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "code_intelligence",
	description:
		"Query the IDE's code intelligence for semantic code navigation. Leverages the IDE's full type resolution, cross-file references, and call graphs — much richer than text-based search. Only available when \"IDE Code Intelligence: Available\" appears in environment_details. If unavailable, fall back to search_files or list_code_definition_names.\n\nSupports batch queries — include multiple queries per call to avoid round-trips.",
	contextRequirements: (context) => context.isCliEnvironment !== true,
	parameters: [
		{
			name: "queries",
			required: true,
			instruction: `One or more queries, one per line, in the format:
    operation | symbol_name
    operation | file_path | symbol_name
    operation | file_path:line | symbol_name

  Operations:
    search         — Find symbols by name (like IDE's Go to Symbol)
    definition     — Go to where a symbol is defined
    references     — Find all usages of a symbol
    callers        — Find methods/functions that call or reference this symbol
    callees        — Find symbols called/referenced within a method/function
    type_hierarchy — Get supertypes and subtypes of a class/interface

  file_path is relative to the workspace root. Line numbers are 1-based.
  When file_path is omitted, all matching definitions are found and
  results are grouped by definition.`,
			usage: `search | GameEngine
callers | resetBoard
definition | src/models/Player.java | Player
callers | src/core/GameEngine.java:42 | makeMove`,
		},
	],
}

export const code_intelligence_variants = [GENERIC]
