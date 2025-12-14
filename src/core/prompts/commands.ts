import type { ApiProviderInfo } from "@/core/api"
import { getDeepPlanningPrompt } from "./commands/deep-planning"

export const newTaskToolResponse = (willUseNativeTools: boolean) => {
	const xmlExample = `
Example:
<new_task>
<context>1. Current Work:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Relevant Files and Code:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Problem Solving:
   [Detailed description]

5. Pending Tasks and Next Steps:
   - [Task 1 details & next steps]
   - [Task 2 details & next steps]
   - [...]</context>
</new_task>
`

	return `<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will generate. The user may have provided instructions or additional information for you to consider when summarizing existing work and creating the context for the new task.
Irrespective of whether additional information or instructions are given, you are ONLY allowed to respond to this message by calling the new_task tool.${willUseNativeTools ? " You MUST call the new_task tool EVEN if it's not in your existing toolset." : ""}

The new_task tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task.
The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation.

Parameters:
- Context: (required) The context to preload the new task with. If applicable based on the current task, this should include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${xmlExample}
Below is the the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>\n
`
}

export const condenseToolResponse = (focusChainSettings?: { enabled: boolean }) =>
	`<explicit_instructions type="condense">
The user has explicitly asked you to create a detailed summary of the conversation so far, which will be used to compact the current context window while retaining key information. The user may have provided instructions or additional information for you to consider when summarizing the conversation.
Irrespective of whether additional information or instructions are given, you are only allowed to respond to this message by calling the condense tool.

The condense tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.
The user will be presented with a preview of your generated summary and can choose to use it to compact their context window or keep chatting in the current conversation.
Users may refer to this tool as 'smol' or 'compact' as well. You should consider these to be equivalent to 'condense' when used in a similar context.

Parameters:
- Context: (required) The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to compact the context window. Pay special attention to the more recent messages / conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${
	focusChainSettings?.enabled
		? `- task_progress: (required) The current state of the task_progress list, with completed items marked. Important information on this parameter is as follows:
  1. XML schema matches that of prior task_progress lists.
  2. All items are retained, with the exact same desciptive content as in prior occurences.
  3. All completed items are marked as completed.
  4. The only compenent of this list that can be changed is the completion state of invidiual items in the list`
		: ""
}

Usage:
<condense>
<context>Your detailed summary</context>
${focusChainSettings?.enabled ? `<task_progress>task_progress list here</task_progress>` : ""}
</condense>

Example:
<condense>
<context>
1. Previous Conversation:
  [Detailed description]

2. Current Work:
  [Detailed description]

3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]

4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]

5. Problem Solving:
  [Detailed description]

6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]
</context>
${
	focusChainSettings?.enabled
		? `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>`
		: ""
}
</condense>

</explicit_instructions>\n
`

export const newRuleToolResponse = () =>
	`<explicit_instructions type="new_rule">
The user has explicitly asked you to help them create a new Cline rule file inside the .clinerules top-level directory based on the conversation up to this point in time. The user may have provided instructions or additional information for you to consider when creating the new Cline rule.
When creating a new Cline rule file, you should NOT overwrite or alter an existing Cline rule file. To create the Cline rule file you MUST use the new_rule tool. The new_rule tool can be used in either of the PLAN or ACT modes.

The new_rule tool is defined below:

Description:
Your task is to create a new Cline rule file which includes guidelines on how to approach developing code in tandem with the user, which can be either project specific or cover more global rules. This includes but is not limited to: desired conversational style, favorite project dependencies, coding styles, naming conventions, architectural choices, ui/ux preferences, etc.
The Cline rule file must be formatted as markdown and be a '.md' file. The name of the file you generate must be as succinct as possible and be encompassing the main overarching concept of the rules you added to the file (e.g., 'memory-bank.md' or 'project-overview.md').

Parameters:
- Path: (required) The path of the file to write to (relative to the current working directory). This will be the Cline rule file you create, and it must be placed inside the .clinerules top-level directory (create this if it doesn't exist). The filename created CANNOT be "default-clineignore.md". For filenames, use hyphens ("-") instead of underscores ("_") to separate words.
- Content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. The content for the Cline rule file MUST be created according to the following instructions:
  1. Format the Cline rule file to have distinct guideline sections, each with their own markdown heading, starting with "## Brief overview". Under each of these headings, include bullet points fully fleshing out the details, with examples and/or trigger cases ONLY when applicable.
  2. These guidelines can be specific to the task(s) or project worked on thus far, or cover more high-level concepts. Guidelines can include coding conventions, general design patterns, preferred tech stack including favorite libraries and language, communication style with Cline (verbose vs concise), prompting strategies, naming conventions, testing strategies, comment verbosity, time spent on architecting prior to development, and other preferences.
  3. When creating guidelines, you should not invent preferences or make assumptions based on what you think a typical user might want. These should be specific to the conversation you had with the user. Your guidelines / rules should not be overly verbose.
  4. Your guidelines should NOT be a recollection of the conversation up to this point in time, meaning you should NOT be including arbitrary details of the conversation.

Usage:
<new_rule>
<path>.clinerules/{file name}.md</path>
<content>Cline rule file content here</content>
</new_rule>

Example:
<new_rule>
<path>.clinerules/project-preferences.md</path>
<content>
## Brief overview
  [Brief description of the rules, including if this set of guidelines is project-specific or global]

## Communication style
  - [Description, rule, preference, instruction]
  - [...]

## Development workflow
  - [Description, rule, preference, instruction]
  - [...]

## Coding best practices
  - [Description, rule, preference, instruction]
  - [...]

## Project context
  - [Description, rule, preference, instruction]
  - [...]

## Other guidelines
  - [Description, rule, preference, instruction]
  - [...]
</content>
</new_rule>

Below is the user's input when they indicated that they wanted to create a new Cline rule file.
</explicit_instructions>\n
`

export const reportBugToolResponse = () =>
	`<explicit_instructions type="report_bug">
The user has explicitly asked you to help them submit a bug to the Cline github page (you MUST now help them with this irrespective of what your conversation up to this point in time was). To do so you will use the report_bug tool which is defined below. However, you must first ensure that you have collected all required information to fill in all the parameters for the tool call. If any of the the required information is apparent through your previous conversation with the user, you can suggest how to fill in those entries. However you should NOT assume you know what the issue about unless it's clear.
Otherwise, you should converse with the user until you are able to gather all the required details. When conversing with the user, make sure you ask for/reference all required information/fields. When referencing the required fields, use human friendly versions like "Steps to reproduce" rather than "steps_to_reproduce". Only then should you use the report_bug tool call.
The report_bug tool can be used in either of the PLAN or ACT modes.

The report_bug tool call is defined below:

Description:
Your task is to fill in all of the required fields for a issue/bug report on github. You should attempt to get the user to be as verbose as possible with their description of the bug/issue they encountered. Still, it's okay, when the user is unaware of some of the details, to set those fields as "N/A".

Parameters:
- title: (required) Concise description of the issue.
- what_happened: (required) What happened and also what the user expected to happen instead.
- steps_to_reproduce: (required) What steps are required to reproduce the bug.
- api_request_output: (optional) Relevant API request output.
- additional_context: (optional) Any other context about this bug not already mentioned.

Usage:
<report_bug>
<title>Title of the issue</title>
<what_happened>Description of the issue</what_happened>
<steps_to_reproduce>Steps to reproduce the issue</steps_to_reproduce>
<api_request_output>Output from the LLM API related to the bug</api_request_output>
<additional_context>Other issue details not already covered</additional_context>
</report_bug>

Below is the user's input when they indicated that they wanted to submit a Github issue.
</explicit_instructions>\n
`

export const subagentToolResponse = () =>
	`<explicit_instructions type="subagent">
The user has requested to invoke a Cline CLI subagent with the context below. You should execute a subagent command to handle this request using the CLI subagents feature.

Transform the user's request into a subagent command by executing:
cline "<prompt>"
</explicit_instructions>\n
`

export const explainChangesToolResponse = () =>
	`<explicit_instructions type="explain_changes">
The user has asked you to explain code changes. You have access to a tool called **generate_explanation** that opens a multi-file diff view with AI-generated inline comments explaining code changes between two git references.

# Important: Use Non-Interactive Commands

When running git or gh commands, always use non-interactive variants to ensure output is returned immediately without requiring user interaction:

- **For git commands**: Use \`git --no-pager\` prefix to disable the pager (e.g., \`git --no-pager log\`, \`git --no-pager diff\`, \`git --no-pager show\`)
- **For gh commands**: Use \`--json\` flag when possible for structured output, or pipe to \`cat\` if needed (e.g., \`gh pr diff 123 | cat\`)

This prevents commands from entering interactive/pager mode which would hang waiting for user input.

# Workflow

Follow these steps to explain code changes:

## 1. Gather Information About the Changes

First, use git or gh CLI tools to understand what changes exist. **Always get the full unified diff output**, not just stats:

- For commits: \`git --no-pager show <commit>\` to see a specific commit's full diff
- For commit ranges: \`git --no-pager log --oneline <from>..<to>\` to see commits in range, then \`git --no-pager diff <from>..<to>\` for full diff
- For branches: \`git --no-pager diff <branch1>..<branch2>\` to see full diff of all changes
- For pull requests: \`gh pr view <number> --json commits,files\` for metadata, then \`gh pr diff <number> | cat\` for full diff
- For staged changes: \`git --no-pager diff --cached\` to see full diff of staged files
- For working directory: \`git --no-pager diff\` for full diff of unstaged changes

To get a comprehensive overview between two refs, run:

**Bash:**
\`\`\`bash
echo "=== COMMITS ==="; git --no-pager log --oneline <from_ref>..<to_ref>; echo "=== CHANGED FILES ==="; git diff <from_ref>..<to_ref> --name-only; echo "=== FULL DIFF ==="; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

**PowerShell:**
\`\`\`powershell
'=== COMMITS ==='; git --no-pager log --oneline <from_ref>..<to_ref>; '=== CHANGED FILES ==='; git diff <from_ref>..<to_ref> --name-only; '=== FULL DIFF ==='; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

Replace \`<from_ref>\` and \`<to_ref>\` with the appropriate git references (commit hashes, branch names, tags, HEAD~1, etc.).

## 2. Build Context for Better Explanations

Before calling generate_explanation, gather context that will help produce more insightful explanations:

- Read relevant files to understand the codebase structure
- Look at related code that the changes interact with
- Check for tests that might explain the intended behavior
- Review any related documentation or comments
- If needed, view file contents at different versions: \`git --no-pager show <ref>:<file>\`

The more context you have in your conversation history, the better the explanations will be since generate_explanation uses the full conversation context when generating comments.

## 3. Determine Git References

Identify the appropriate git references for the diff:

- **from_ref**: The "before" state (commit hash, branch name, tag, HEAD~1, etc.)
- **to_ref**: The "after" state (optional - defaults to working directory if omitted)

Examples of reference combinations:
- Last commit: from_ref="HEAD~1", to_ref="HEAD"
- Specific commit: from_ref="abc123^", to_ref="abc123"
- Branch comparison: from_ref="main", to_ref="feature-branch"
- Staged changes: from_ref="HEAD" (omit to_ref to compare to working directory with staged changes)
- PR changes: from_ref="main", to_ref="pr-branch-name"

## 4. Call generate_explanation

Use the generate_explanation tool with:
- **title**: A descriptive title for the diff view (e.g., "Changes in commit abc123", "PR #42: Add user authentication")
- **from_ref**: The git reference for the "before" state
- **to_ref**: The git reference for the "after" state (optional)
Below is the user's input describing what changes they want explained. If no input is provided, default to analyzing uncommitted changes in the working directory (may or may not be staged).
</explicit_instructions>\n
`

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export const deepPlanningToolResponse = (
	focusChainSettings?: { enabled: boolean },
	providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
) => {
	return getDeepPlanningPrompt(focusChainSettings, providerInfo, enableNativeToolCalls)
}
