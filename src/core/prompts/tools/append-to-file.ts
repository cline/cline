import { ToolArgs } from "./types"

export function getAppendToFileDescription(args: ToolArgs): string {
	return `## append_to_file
Description: Request to append content to a file at the specified path. If the file exists, the content will be appended to the end of the file. If the file doesn't exist, it will be created with the provided content. This tool will automatically create any directories needed to write the file.
Parameters:
- path: (required) The path of the file to append to (relative to the current workspace directory ${args.cwd})
- content: (required) The content to append to the file. The content will be added at the end of the existing file content. Do NOT include line numbers in the content.
Usage:
<append_to_file>
<path>File path here</path>
<content>
Your content to append here
</content>
</append_to_file>

Example: Requesting to append to a log file
<append_to_file>
<path>logs/app.log</path>
<content>
[2024-04-17 15:20:30] New log entry
[2024-04-17 15:20:31] Another log entry
</content>
</append_to_file>`
}
