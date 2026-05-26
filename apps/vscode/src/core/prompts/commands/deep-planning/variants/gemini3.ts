import { isGemini3ModelFamily } from "@utils/model-utils"
import { getShell } from "@utils/shell"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import type { DeepPlanningVariant } from "../types"

/**
 * Creates the Gemini 3 variant for deep-planning prompt
 */
export function createGemini3Variant(): DeepPlanningVariant {
	return {
		id: "gemini-3",
		description: "Deep-planning variant optimized for Gemini 3 models",
		family: "gemini-3",
		version: 1,
		matcher: (context: SystemPromptContext) => {
			const modelId = context.providerInfo?.model?.id
			if (!modelId) {
				return false
			}
			return isGemini3ModelFamily(modelId)
		},
		template: "", // Template is dynamically generated in getDeepPlanningPrompt() based on focus chain settings
	}
}

/**
 * Generates the deep-planning template with shell-specific commands
 * @param focusChainEnabled Whether focus chain (task_progress) is enabled for this task
 * @param enableNativeToolCalls Whether native tool calling is enabled
 */
export function generateGemini3Template(focusChainEnabled: boolean, enableNativeToolCalls: boolean): string {
	const detectedShell = getShell()

	let isPowerShell = false
	try {
		isPowerShell =
			detectedShell != null &&
			typeof detectedShell === "string" &&
			(detectedShell.toLowerCase().includes("powershell") || detectedShell.toLowerCase().includes("pwsh"))
	} catch {}

	return `<explicit_instructions type="deep-planning">
Your task is to create a comprehensive implementation plan before writing any code. This process has five distinct steps that must be completed in order:
1. Silent Read Investigation
2. Silent Terminal Investigation
3. Discussion and Questions
4. Create Implementation Plan Document
5. Create new_task for Implementation Phase

${focusChainEnabled ? `You should track these five steps in your task_progress parameter, and update it only when steps are completed.` : ""}
Your behavior should be methodical and thorough - take time to understand the codebase completely before making any recommendations. The quality of your investigation and use of targeted reads/searches directly impacts the success of the implementation.

<IMPORTANT>
Execute only exploration and plan generation steps until explicitly instructed by the user to proceed with coding.
You must thoroughly understand the existing codebase before proposing any changes.
Perform your research without commentary or narration. Execute commands and read files without explaining what you're about to do. Only speak up if you have specific questions for the user.
</IMPORTANT>

## STEP 1: Silent Read Investigation

### Required Research Activities
You MUST first use the read_file tool to examine several source files, configuration files, and documentation to better inform subsequent research steps. You should only use read_file to prepare for more granular searching. Use this step to get the big picture, then you will use the next step for granular details by searching using terminal commands. Use this tool to determine the language(s) used in the codebase, and to identify the domain(s) relevant to the user's request.


## STEP 2: Silent Terminal Investigation

### Required Research Activities
You MUST use terminal commands to gather information about the codebase structure and patterns relevant to the user's request.
You will tailor these commands to explore and identify key functions, classes, methods, types, and variables that are directly, or indirectly related to the task.
These commands must be crafted to not produce exceptionally long or verbose search results. For example, you should exclude dependency folders such as node_modules, venv or php vendor, etc. Carefully consider the scope of search patterns. Use the results of your read_file tool calls to tailor the commands for balanced search result lengths. If a command returns no results, you may loosen the search patterns or scope slightly. If a command returns hundreds or thousands of results, you should adjust subsequent commands to be more targeted.
Execute these commands to build your understanding. Adjust subsequent commands based on the output you have received from each previous command, informing the scope and direction of your search.
You should only execute one command at a time for the first 1-3 commands. Do not chain search commands until you have executed and interpreted the results of several search commands, then use the context you have gathered to inform more complex chained commands.

Here are some example commands, remember to adjust them as instructed previously:
${
	isPowerShell
		? // PowerShell-specific commands
			`
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
		: // bash/zsh-specific commands
			`
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
}


## STEP 3: Discussion and Questions

Ask the user brief, targeted questions that will influence your implementation plan. Keep your questions concise and conversational. Ask only essential questions needed to create an accurate plan.

**Ask questions only when necessary for:**
- Clarifying ambiguous requirements or unclear specifications
- Choosing between multiple equally valid implementation approaches that have significant trade-offs
- Confirming non-trivial assumptions about existing system behavior or constraints
- Understanding preferences for specific technical decisions that will affect the final implementation's behavior or code maintainability

Your questions should be direct and specific. Avoid long explanations or multiple questions in one response. Only ask one question at a time. You may ask several questions if required and within scope of the task.

## STEP 4: Create Implementation Plan Document

Once you have obtained sufficient context to understand all code modifications that will be required, create a structured markdown document containing your complete implementation plan. The document must follow this exact format with clearly marked sections:

### Document Structure Requirements

Your implementation plan must be saved as implementation_plan.md, and *must* be structured as follows:

<example_implementation_plan>
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

[Implementation Order]
Single sentence describing the implementation sequence.

Numbered steps showing the logical order of changes to minimize conflicts and ensure successful integration.
${focusChainEnabled ? "A task_progress list of steps that will need to be completed during the implementation" : ""}

</example_implementation_plan>

## STEP 5: Create Implementation new_task

Use the new_task command to create a task for implementing the plan. ${focusChainEnabled ? "The task must include a <task_progress> list that breaks down the implementation into trackable steps." : ""}

### Task Creation Requirements

<IMPORTANT>
**Standalone Product:**
Your new task should be self-contained and reference the plan document rather than requiring additional codebase investigation. Include these specific instructions in the task description:

${
	focusChainEnabled
		? `**Task Progress Format:**
You absolutely MUST include the task_progress contents in context when creating the new task. When providing it, do not wrap it in XML tags- instead provide it like this:

task_progress Items:
- [ ] Step 1: Brief description of first implementation step
- [ ] Step 2: Brief description of second implementation step  
- [ ] Step 3: Brief description of third implementation step
- [ ] Step N: Brief description of subsequent/final implementation step(s)

**Markdown Implementation Plan Path:**
You also MUST include the path to the markdown file you have created in your new task prompt. You should do this as follows:
  Refer to @path/to/file/markdown.md for a complete breakdown of the task requirements and steps. You should periodically read this file again.`
		: ""
}
</IMPORTANT>

${
	enableNativeToolCalls
		? `**new_task Tool Definition:**

When you are ready to create the implementation task, you must call the new_task tool with the following structure:

{
  "name": "new_task",
  "arguments": {
    "context": "Your detailed context here following the 5-point structure..."
  }
}

The context parameter should include all five sections as described above.

`
		: `**new_task Tool Definition:**

When you are ready to create the implementation task, you must call the new_task tool with the following structure:

<new_task>
<context>Your detailed context here following the 5-point structure...</context>
</new_task>

The context parameter should include all five sections as described above.

`
}
### Mode Switching

<IMPORTANT>
When creating the new task, request a switch to "act mode" if you are currently in "plan mode". This ensures the implementation agent operates in execution mode rather than planning mode.
</IMPORTANT>

## Quality Standards

You must be specific with exact file paths, function names, and class names. You must be comprehensive and avoid assuming implicit understanding. You must be practical and consider real-world constraints and edge cases. You must use precise technical language and avoid ambiguity.

Your implementation plan should be detailed enough that another developer could execute it without additional investigation.

---

**Execute all five steps in sequence. Your role is to plan thoroughly, not to implement. Code creation begins only after the new task is created and you receive explicit instruction to proceed.**

Below is the user's input from when they indicated that they wanted to create this comprehensive implementation plan.
</explicit_instructions>
`
}
