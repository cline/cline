import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.CHANGE_DIRECTORY,
	name: "change_directory",
	description: `Request to change the current working directory for all subsequent operations. This changes the base directory used for file operations, terminal commands, and path resolution. Use this when you need to work in a different project or directory than the one you started in.

Important notes:
- The path must be an absolute path to an existing directory
- After changing directory, all relative paths will resolve against the new directory
- File listings in environment_details will reflect the new directory
- New terminal sessions will start in the new directory
- Checkpoints will be disabled after changing directory
- This tool is only available in CLI environments`,
	contextRequirements: (context) => context.isCliEnvironment === true,
	parameters: [
		{
			name: "path",
			required: true,
			instruction: "The absolute path of the directory to change to. Must be an existing directory.",
			usage: "/Users/username/projects/other-project",
		},
	],
}

export const change_directory_variants = [GENERIC]
