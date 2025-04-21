import { ToolArgs } from "./types"

export function getSearchAndReplaceDescription(args: ToolArgs): string {
	return `## search_and_replace
Description: Request to perform a search and replace operation on a file. Supports both literal text and regex patterns. Shows a diff preview before applying changes.

Required Parameters:
- path: The path of the file to modify (relative to the current workspace directory ${args.cwd.toPosix()})
- search: The text or pattern to search for
- replace: The text to replace matches with

Optional Parameters:
- start_line: Starting line number for restricted replacement (1-based)
- end_line: Ending line number for restricted replacement (1-based)
- use_regex: Set to "true" to treat search as a regex pattern (default: false)
- ignore_case: Set to "true" to ignore case when matching (default: false)

Notes:
- When use_regex is true, the search parameter is treated as a regular expression pattern
- When ignore_case is true, the search is case-insensitive regardless of regex mode

Examples:

1. Simple text replacement:
<search_and_replace>
<path>example.ts</path>
<search>oldText</search>
<replace>newText</replace>
</search_and_replace>

2. Case-insensitive regex pattern:
<search_and_replace>
<path>example.ts</path>
<search>old\w+</search>
<replace>new$&</replace>
<use_regex>true</use_regex>
<ignore_case>true</ignore_case>
</search_and_replace>`
}
