import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## select_file
Description: Request to open a file selection dialog to choose files or folders. This tool allows users to select files or directories through the VS Code file picker interface.
Parameters:
- title: (optional) The title of the file selection dialog
- canSelectFiles: (optional) Whether files can be selected (default: true)
- canSelectFolders: (optional) Whether folders can be selected (default: false)
- canSelectMany: (optional) Whether multiple items can be selected (default: false)
- filters: (optional) File filters to apply in the dialog
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : ""}
Usage:
<select_file>
<title>Select a file to process</title>
<canSelectFiles>true</canSelectFiles>
<canSelectFolders>false</canSelectFolders>
<canSelectMany>false</canSelectMany>
</select_file>
 */

const id = ClineDefaultTool.SELECT_FILE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "select_file",
	description: "Request to open a file selection dialog to choose files or folders. This tool allows users to select files or directories through the VS Code file picker interface.",
	parameters: [
		{
			name: "title",
			required: false,
			instruction: "The title of the file selection dialog",
			usage: "Select a file to process",
		},
		{
			name: "canSelectFiles",
			required: false,
			instruction: "Whether files can be selected (true/false, default: true)",
			usage: "true",
		},
		{
			name: "canSelectFolders",
			required: false,
			instruction: "Whether folders can be selected (true/false, default: false)",
			usage: "false",
		},
		{
			name: "canSelectMany",
			required: false,
			instruction: "Whether multiple items can be selected (true/false, default: false)",
			usage: "false",
		},
		{
			name: "filters",
			required: false,
			instruction: "File filters to apply in the dialog (JSON object)",
			usage: '{"Text Files": ["txt", "md"], "Code Files": ["js", "ts", "py"]}',
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const select_file_variants = [generic]