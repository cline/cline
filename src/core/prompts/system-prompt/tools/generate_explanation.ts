import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.GENERATE_EXPLANATION

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "generate_explanation",
	description:
		"Opens a multi-file diff view and generates AI-powered inline comments explaining the changes between two git references. Use this tool to help users understand code changes from git commits, pull requests, branches, or any git refs. The tool uses git to retrieve file contents and displays a side-by-side diff view with explanatory comments.",
	parameters: [
		{
			name: "title",
			required: true,
			instruction:
				"A descriptive title for the diff view (e.g., 'Changes in commit abc123', 'PR #42: Add authentication', 'Changes between main and feature-branch')",
			usage: "Changes in last commit",
		},
		{
			name: "from_ref",
			required: true,
			instruction:
				"The git reference for the 'before' state. Can be a commit hash, branch name, tag, or relative reference like HEAD~1, HEAD^, origin/main, etc.",
			usage: "HEAD~1",
		},
		{
			name: "to_ref",
			required: false,
			instruction:
				"The git reference for the 'after' state. Can be a commit hash, branch name, tag, or relative reference. If not provided, compares to the current working directory (including uncommitted changes).",
			usage: "HEAD",
		},
	],
}

export const generate_explanation_variants = [GENERIC]
