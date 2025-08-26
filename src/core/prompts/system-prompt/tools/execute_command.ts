import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.BASH,
	name: "execute_command",
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: {{CWD}}`,
	parameters: [
		{
			name: "command",
			required: true,
			instruction: "The CLI command to execute...",
			usage: "Your command here",
		},
		{
			name: "requires_approval",
			required: true,
			instruction: "A boolean indicating whether...",
			usage: "true or false",
		},
	],
}

const gpt = {
	variant: ModelFamily.GPT,
	id: ClineDefaultTool.BASH,
	name: "bash",
	description:
		"Run an arbitrary terminal command at the root of the users project. E.g. `ls -la` for listing files, or `find` for searching latest version of the codebase files locally.",
	parameters: [
		{
			name: "command",
			required: true,
			instruction: "The command to run in the root of the users project. Must be shell escaped.",
			usage: "Your command here",
		},
		{
			name: "requires_approval",
			required: false,
			instruction: "Whether the command is dangerous. If true, user will be asked to confirm.",
		},
	],
}

export const execute_command_variants = [generic, gpt]
