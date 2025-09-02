import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const EDITING_FILES_TEMPLATE_TEXT = `EDITING FILES

You have access to three tools for working with files: **edit_file**, **replace_in_file**, and **write_to_file**. Your default tool for any modification to an existing file must be **edit_file**. The other tools should only be used as fallbacks in specific scenarios.

**Decision Hierarchy: Always prefer \`edit_file\` > \`replace_in_file\` > \`write_to_file\` for existing files.**

# edit_file (Primary Tool)

## Purpose
Make semantic, targeted edits to existing files by specifying only the changed lines and using placeholders for unchanged code. This is the safest and most efficient method.

## When to Use
- **This is your default tool for all edits to existing files.**
- Use for single or multiple changes within a file, from simple line edits to complex structural refactoring.

## Important Considerations
- Use placeholders to represent unchanged sections (e.g., \`// ... existing code ...\`). Provide minimal but sufficient surrounding context (1-3 lines) before and after your changes to ensure accuracy.
- Combine all required changes for a single file into one \`edit_file\` call. The tool is designed to handle multiple distinct edits at once.

# replace_in_file (Fallback Tool)

## Purpose & When to Use
Use this tool **only as a fallback** to \`edit_file\` if it has failed. It performs a simple search and replace.

# write_to_file (Use with Caution)

## Purpose & When to Use
- **Creating new files.**
- **Complete rewrites:** Only use this to overwrite an existing file when the changes are so extensive that both \`edit_file\` and \`replace_in_file\` are impractical or impossible.

# Choosing the Appropriate Tool

- **Always default to \`edit_file\` for any modification.** It is the most robust and preferred method.

# Auto-formatting Considerations

- After using edit_file, the user's editor may automatically format the file
- This auto-formatting may modify the file contents, for example:
  - Breaking single lines into multiple lines
  - Adjusting indentation to match project style (e.g. 2 spaces vs 4 spaces vs tabs)
  - Converting single quotes to double quotes (or vice versa based on project preferences)
  - Organizing imports (e.g. sorting, grouping by type)
  - Adding/removing trailing commas in objects and arrays
  - Enforcing consistent brace style (e.g. same-line vs new-line)
  - Standardizing semicolon usage (adding or removing based on style)
- The edit_file tool response will include the final state of the file after any auto-formatting
- Use this final state as your reference point for any subsequent edits.`

export async function getEditingFilesSection(variant: PromptVariant, _context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || EDITING_FILES_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, {})
}
