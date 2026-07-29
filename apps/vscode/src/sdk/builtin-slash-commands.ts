/**
 * Prompt expansions for built-in slash commands on the SDK runtime.
 *
 * The webview advertises built-in commands (shared/slashCommands.ts), but the
 * SDK send path only expands workflow/skill commands discovered on disk.
 * Built-ins that work via prompt expansion are handled here instead, before
 * workflow/skill expansion, mirroring how the legacy extension's
 * parseSlashCommands gave built-ins precedence.
 *
 * `/deep-planning` is ported from the legacy extension's generic variant
 * (core/prompts/commands/deep-planning/variants/generic.ts) with one
 * pragmatic change: legacy's STEP 4 created an implementation task via the
 * `new_task` tool, which does not exist on the SDK runtime, so the final step
 * now presents the plan and asks the user how to proceed.
 */

import { getShell } from "@/utils/shell"

/**
 * Matches a leading-or-whitespace-preceded `/deep-planning` token followed by
 * whitespace or end-of-string, mirroring the token rules of
 * slash-command-expansion.ts (and the legacy parser) so URLs and file paths
 * never match.
 */
const DEEP_PLANNING_COMMAND_REGEX = /(^|\s)\/deep-planning(?=\s|$)/i

function isPowerShell(): boolean {
	try {
		const detectedShell = getShell()
		return (
			typeof detectedShell === "string" &&
			(detectedShell.toLowerCase().includes("powershell") || detectedShell.toLowerCase().includes("pwsh"))
		)
	} catch {
		return false
	}
}

const POSIX_RESEARCH_COMMANDS = `
# Discover project structure and file types
find . -type f -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.cpp" -o -name "*.go" | head -30 | cat

# Find all class and function definitions
grep -r "class\\|function\\|def\\|interface\\|struct\\|func\\|type.*struct\\|type.*interface" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" --include="*.go" . | cat

# Analyze import patterns and dependencies
grep -r "import\\|from\\|require\\|#include" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" . | sort | uniq | cat

# Find dependency manifests
find . -name "requirements*.txt" -o -name "package.json" -o -name "Cargo.toml" -o -name "pom.xml" -o -name "Gemfile" -o -name "go.mod" | xargs cat

# Identify technical debt and TODOs
grep -r "TODO\\|FIXME\\|XXX\\|HACK\\|NOTE" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" --include="*.go" . | cat
`

const POWERSHELL_RESEARCH_COMMANDS = `
# Discover project structure and file types
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-Object -First 30 | Select-Object FullName

# Find all class and function definitions
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-String -Pattern "class|function|def|interface|struct"

# Analyze import patterns and dependencies
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp" | Select-String -Pattern "import|from|require|#include" | Sort-Object | Get-Unique

# Find dependency manifests
Get-ChildItem -Recurse -Include "requirements*.txt","package.json","Cargo.toml","pom.xml","Gemfile","go.mod" | Get-Content

# Identify technical debt and TODOs
Get-ChildItem -Recurse -Include "*.py","*.js","*.ts","*.java","*.cpp","*.go" | Select-String -Pattern "TODO|FIXME|XXX|HACK|NOTE"
`

function buildDeepPlanningInstructions(): string {
	const researchCommands = isPowerShell() ? POWERSHELL_RESEARCH_COMMANDS : POSIX_RESEARCH_COMMANDS

	return `<explicit_instructions type="deep-planning">
Your task is to create a comprehensive implementation plan before writing any code. This process has four distinct steps that must be completed in order.

Your behavior should be methodical and thorough - take time to understand the codebase completely before making any recommendations. The quality of your investigation directly impacts the success of the implementation.

## STEP 1: Silent Investigation

<important>
Do not write any code until explicitly instructed by the user to proceed with coding.
You must thoroughly understand the existing codebase before proposing any changes.
Perform your research without commentary or narration. Execute commands and read files without explaining what you're about to do. Only speak up if you have specific questions for the user.
</important>

### Required Research Activities
You must use your file reading tools to examine relevant source files, configuration files, and documentation. You must use terminal commands to gather information about the codebase structure and patterns. All terminal output must be piped to cat for visibility.

### Essential Terminal Commands
First, determine the language(s) used in the codebase, then execute these commands to build your understanding. You must tailor them to the codebase and ensure the output is not overly verbose. For example, you should exclude dependency folders such as node_modules, venv or php vendor, etc. These are only examples, the exact commands will differ depending on the codebase.
${researchCommands}

## STEP 2: Discussion and Questions

Ask the user brief, targeted questions that will influence your implementation plan. Keep your questions concise and conversational. Ask only essential questions needed to create an accurate plan.

**Ask questions only when necessary for:**
- Clarifying ambiguous requirements or specifications
- Choosing between multiple equally valid implementation approaches
- Confirming assumptions about existing system behavior or constraints
- Understanding preferences for specific technical decisions that will affect the implementation

Your questions should be direct and specific. Avoid long explanations or multiple questions in one response.

## STEP 3: Create Implementation Plan Document

Create a structured markdown document containing your complete implementation plan. The document must follow this exact format with clearly marked sections:

### Document Structure Requirements

Your implementation plan must be saved as implementation_plan.md, and *must* be structured as follows:


# Implementation Plan

[Overview]
Single sentence describing the overall goal.

Multiple paragraphs outlining the scope, context, and high-level approach. Explain why this implementation is needed and how it fits into the existing system.

[Types]
Single sentence describing the type system changes.

Detailed type definitions, interfaces, enums, or data structures with complete specifications. Include field names, types, validation rules, and relationships.

[Files]
Single sentence describing file modifications.

Detailed breakdown:
- New files to be created (with full paths and purpose)
- Existing files to be modified (with specific changes)
- Files to be deleted or moved
- Configuration file updates

[Functions]
Single sentence describing function modifications.

Detailed breakdown:
- New functions (name, signature, file path, purpose)
- Modified functions (exact name, current file path, required changes)
- Removed functions (name, file path, reason, migration strategy)

[Classes]
Single sentence describing class modifications.

Detailed breakdown:
- New classes (name, file path, key methods, inheritance)
- Modified classes (exact name, file path, specific modifications)
- Removed classes (name, file path, replacement strategy)

[Dependencies]
Single sentence describing dependency modifications.

Details of new packages, version changes, and integration requirements.

[Testing]
Single sentence describing testing approach.

Test file requirements, existing test modifications, and validation strategies.

[Implementation Order]
Single sentence describing the implementation sequence.

Numbered steps showing the logical order of changes to minimize conflicts and ensure successful integration.


## STEP 4: Hand Off for Implementation

Once the plan document is saved, present a concise summary of the plan to the user and ask whether to proceed with the implementation. Reference the plan document so it can be consulted during implementation, like this:

Refer to @implementation_plan.md for a complete breakdown of the task requirements and steps.

Do not begin implementing until the user explicitly confirms.

## Quality Standards

You must be specific with exact file paths, function names, and class names. You must be comprehensive and avoid assuming implicit understanding. You must be practical and consider real-world constraints and edge cases. You must use precise technical language and avoid ambiguity.

Your implementation plan should be detailed enough that another developer could execute it without additional investigation.

---

**Execute all four steps in sequence. Your role is to plan thoroughly, not to implement. Code creation begins only after the user gives explicit instruction to proceed.**

Below is the user's input when they indicated that they wanted to create a comprehensive implementation plan.
</explicit_instructions>
`
}

/**
 * Expand the first `/deep-planning` token in `text` into the deep-planning
 * instructions, mirroring legacy semantics (instructions first, token removed,
 * the rest of the user's message preserved). Returns the input unchanged when
 * the token is absent.
 */
export function expandBuiltinSlashCommands(text: string): { text: string; expanded: boolean } {
	const match = DEEP_PLANNING_COMMAND_REGEX.exec(text)
	if (!match) {
		return { text, expanded: false }
	}
	const tokenStart = match.index + match[1].length
	const tokenEnd = tokenStart + "/deep-planning".length
	const remainder = (text.slice(0, tokenStart) + text.slice(tokenEnd)).trim()
	return { text: `${buildDeepPlanningInstructions()}\n${remainder}`, expanded: true }
}
