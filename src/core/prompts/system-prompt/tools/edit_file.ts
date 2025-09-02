import { ModelFamily } from "@/shared/prompts"
import type { ClineToolSpec } from "../spec"

// This description is derived directly from the MORPH_APPLY_INTEGRATION.md guidelines.
const EDIT_FILE_DESCRIPTION = `Use this tool to make an edit to an existing file. This is the preferred way to modify files.

This will be read by a specialized, fast model (Morph Apply Model), which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.
When writing the edit, you should specify each edit in sequence, with the special comment \`// ... existing code ...\` (or the equivalent comment syntax for the file's language) to represent unchanged code in between edited lines.

For example:

// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...

You should still bias towards repeating as few lines of the original file as possible to convey the change.
But, each edit should contain minimally sufficient context (1-3 lines) of unchanged lines around the code you're editing to resolve ambiguity.
DO NOT omit spans of pre-existing code (or comments) without using the \`// ... existing code ...\` comment to indicate its absence. If you omit the existing code comment, the apply model may inadvertently delete these lines.

# Deleting Code
If you plan on deleting a section, you must provide context before and after the section you want to remove.
Example: If the initial code is:
\`\`\`
function keepThis() { return "stay"; }
function removeThis() { return "go"; }
function alsoKeepThis() { return "also stay"; }
\`\`\`
And you want to remove \`removeThis\`, your output should be:
\`\`\`
// ... existing code ...
function keepThis() { return "stay"; }

function alsoKeepThis() { return "also stay"; }
// ... existing code ...
\`\`\`

# Multiple Edits
Make all edits to a file in a single \`edit_file\` call instead of multiple calls to the same file. The apply model can handle many distinct edits at once.`

export const edit_file: ClineToolSpec = {
	// Casting to any because src/shared/tools.ts is not available in context yet.
	id: "edit_file" as any,
	variant: ModelFamily.GENERIC,
	name: "edit_file",
	description: EDIT_FILE_DESCRIPTION,
	parameters: [
		{
			name: "target_file",
			required: true,
			description: "The path to the file that needs to be modified.",
			instruction: "Specify the relative path to the file you want to edit.",
		},
		{
			name: "instructions",
			required: true,
			description:
				"A single sentence instruction describing what you are going to do for the sketched edit. This is used to assist the apply model. Use the first person to describe what you are going to do. Use it to disambiguate uncertainty in the edit.",
			instruction:
				'Provide a concise, first-person description of the change (e.g., "I am adding async error handling to the login function.").',
		},
		{
			name: "code_edit",
			required: true,
			description:
				"The abbreviated code snippet representing the change. Must use `// ... existing code ...` (or equivalent comment syntax) to represent unchanged sections.",
			instruction:
				"Provide the code snippet with your changes, using `// ... existing code ...` for unchanged sections. Include minimal context around your edits.",
		},
	],
}

export const edit_file_variants = [edit_file]
