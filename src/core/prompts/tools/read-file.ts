import { ToolArgs } from "./types"

export function getReadFileDescription(args: ToolArgs): string {
	const maxConcurrentReads = args.settings?.maxConcurrentFileReads ?? 5
	const isMultipleReadsEnabled = maxConcurrentReads > 1

	return `## read_file
Description: Request to read the contents of ${isMultipleReadsEnabled ? "one or more files" : "a file"}. The tool outputs line-numbered content (e.g. "1 | const x = 1") for easy reference when creating diffs or discussing code.${args.partialReadsEnabled ? " Use line ranges to efficiently read specific portions of large files." : ""} Supports text extraction from PDF and DOCX files, but may not handle other binary files properly.

${isMultipleReadsEnabled ? `**IMPORTANT: You can read a maximum of ${maxConcurrentReads} files in a single request.** If you need to read more files, use multiple sequential read_file requests.` : "**IMPORTANT: Multiple file reads are currently disabled. You can only read one file at a time.**"}

${args.partialReadsEnabled ? `By specifying line ranges, you can efficiently read specific portions of large files without loading the entire file into memory.` : ""}
Parameters:
- args: Contains one or more file elements, where each file contains:
  - path: (required) File path (relative to workspace directory ${args.cwd})
  ${args.partialReadsEnabled ? `- line_range: (optional) One or more line range elements in format "start-end" (1-based, inclusive)` : ""}

Usage:
<read_file>
<args>
  <file>
    <path>path/to/file</path>
    ${args.partialReadsEnabled ? `<line_range>start-end</line_range>` : ""}
  </file>
</args>
</read_file>

Examples:

1. Reading a single file:
<read_file>
<args>
  <file>
    <path>src/app.ts</path>
    ${args.partialReadsEnabled ? `<line_range>1-1000</line_range>` : ""}
  </file>
</args>
</read_file>

${isMultipleReadsEnabled ? `2. Reading multiple files (within the ${maxConcurrentReads}-file limit):` : ""}${
		isMultipleReadsEnabled
			? `
<read_file>
<args>
  <file>
    <path>src/app.ts</path>
    ${
		args.partialReadsEnabled
			? `<line_range>1-50</line_range>
    <line_range>100-150</line_range>`
			: ""
	}
  </file>
  <file>
    <path>src/utils.ts</path>
    ${args.partialReadsEnabled ? `<line_range>10-20</line_range>` : ""}
  </file>
</args>
</read_file>`
			: ""
	}

${isMultipleReadsEnabled ? "3. " : "2. "}Reading an entire file:
<read_file>
<args>
  <file>
    <path>config.json</path>
  </file>
</args>
</read_file>

IMPORTANT: You MUST use this Efficient Reading Strategy:
- ${isMultipleReadsEnabled ? `You MUST read all related files and implementations together in a single operation (up to ${maxConcurrentReads} files at once)` : "You MUST read files one at a time, as multiple file reads are currently disabled"}
- You MUST obtain all necessary context before proceeding with changes
${
	args.partialReadsEnabled
		? `- You MUST use line ranges to read specific portions of large files, rather than reading entire files when not needed
- You MUST combine adjacent line ranges (<10 lines apart)
- You MUST use multiple ranges for content separated by >10 lines
- You MUST include sufficient line context for planned modifications while keeping ranges minimal
`
		: ""
}
${isMultipleReadsEnabled ? `- When you need to read more than ${maxConcurrentReads} files, prioritize the most critical files first, then use subsequent read_file requests for additional files` : ""}`
}
