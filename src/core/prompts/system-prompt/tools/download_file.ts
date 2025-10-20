import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## download_file
Description: Request to download a file from an HTTP URL and save it to a local path. This tool handles HTTP file downloads and saves them to the specified location on the local filesystem.
Parameters:
- fileUrl: (required) The HTTP URL of the file to download
- savePath: (required) The local filesystem path where the downloaded file should be saved
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : ""}
Usage:
<download_file>
<fileUrl>https://example.com/file.zip</fileUrl>
<savePath>./downloads/file.zip</savePath>
${focusChainSettings.enabled ? `<task_progress>
Checklist here (optional)
</task_progress>` : "" }
</download_file>
 */

const id = ClineDefaultTool.DOWNLOAD_FILE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "download_file",
	description: "Request to download a file from an HTTP URL and save it to a local path. This tool handles HTTP file downloads and saves them to the specified location on the local filesystem.",
	parameters: [
		{
			name: "fileUrl",
			required: true,
			instruction: "The HTTP URL of the file to download (e.g., https://example.com/file.zip)",
			usage: "https://example.com/file.zip",
		},
		{
			name: "savePath",
			required: true,
			instruction: "The local filesystem path where the downloaded file should be saved (relative to the current working directory {{CWD}})",
			usage: "./downloads/file.zip",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const download_file_variants = [generic]