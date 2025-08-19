import { ToolArgs } from "./types"

/**
 * Generate a simplified read_file tool description for models that only support single file reads
 * Uses the simpler format: <read_file><path>file/path.ext</path></read_file>
 */
export function getSimpleReadFileDescription(args: ToolArgs): string {
	return `## read_file
Description: Request to read the contents of a file. The tool outputs line-numbered content (e.g. "1 | const x = 1") for easy reference when discussing code.

Parameters:
- path: (required) File path (relative to workspace directory ${args.cwd})

Usage:
<read_file>
<path>path/to/file</path>
</read_file>

Examples:

1. Reading a TypeScript file:
<read_file>
<path>src/app.ts</path>
</read_file>

2. Reading a configuration file:
<read_file>
<path>config.json</path>
</read_file>

3. Reading a markdown file:
<read_file>
<path>README.md</path>
</read_file>`
}
