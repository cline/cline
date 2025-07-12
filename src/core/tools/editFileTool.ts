import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const editFileToolDefinition = (cwd: string): ToolDefinition => ({
	name: "EditFile",
	descriptionForAgent: `Use this tool to propose an edit to an existing file or create a new file.

This will be read by a less intelligent model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.
When writing the edit, you should specify each edit in sequence, with the special comment \`// ... existing code ...\` to represent unchanged code in between edited lines.

For example:

\`\`\`
// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...
THIRD_EDIT
// ... existing code ...
\`\`\`

You should still bias towards repeating as few lines of the original file as possible to convey the change.
But, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.
DO NOT omit spans of pre-existing code (or comments) without using the \`// ... existing code ...\` comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.
Make sure it is clear what the edit should be, and where it should be applied.
To create a new file, simply specify the content of the file in the \`code_edit\` field.

You should specify the following arguments before the others: [target_file]

ALWAYS make all edits to a file in a single edit_file instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once. When editing multiple files, ALWAYS make parallel edit_file calls.`,
	inputSchema: {
		type: "object",
		properties: {
			target_file: {
				type: "string",
				description: `The path of the file to edit (relative to the current working directory ${cwd.toPosix()})`,
			},
			instructions: {
				type: "string",
				description:
					"A single sentence instruction describing what you are going to do for the sketched edit. This is used to assist the less intelligent model in applying the edit. Please use the first person to describe what you are going to do. Dont repeat what you have said previously in normal messages. And use it to disambiguate uncertainty in the edit.",
			},
			code_edit: {
				type: "string",
				description:
					"Specify ONLY the precise lines of code that you wish to edit. **NEVER specify or write out unchanged code**. Instead, represent all unchanged code using the comment of the language you're editing in - example: `// ... existing code ...`",
			},
		},
		required: ["target_file", "instructions", "code_edit"],
	},
})
