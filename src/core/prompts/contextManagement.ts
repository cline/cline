export const summarizeTask = (focusChainSettings?: { enabled: boolean }, cwd?: string, isMultiRootEnabled?: boolean) => {
	// Build CWD display text
	const CWD = cwd ? cwd.toPosix() : ""

	// Build MULTI_ROOT_HINT text (matches pattern in tools.ts)
	const MULTI_ROOT_HINT = isMultiRootEnabled
		? " Use @workspace:path syntax (e.g., @frontend:src/index.ts) to specify a workspace."
		: ""

	return `<explicit_instructions type="summarize_task">
The current conversation is running out of context space. Your task is to create a focused narrative summary of the conversation's middle section, capturing the essential story and technical details needed to continue the work.

IMPORTANT: The most recent messages (last ~8 exchanges) will be preserved intact, so you do NOT need to summarize recent context. Your summary should focus on what happened BEFORE the recent messages.

You have only two options: If you are immediately prepared to call the attempt_completion tool, and have completed all items in your task_progress list, you may call attempt_completion at this time. If you are not prepared to call the attempt_completion tool, and have not completed all items in your task_progress list, you must call the summarize_task tool - in this case you must call the summarize_task tool whether you are in PLAN or ACT mode.

You MUST ONLY respond to this message by using either the attempt_completion tool or the summarize_task tool call. When using the summarize_task tool call, you must include ALL information in the summary required for continuing with the task at hand. This is because you will lose access to messages in the middle section (the recent messages will remain available).

When responding with the summarize_task tool call, follow these instructions:

Before providing your final summary, wrap your analysis in <thinking> tags to organize your thoughts and ensure you've covered all necessary points.

CRITICAL CONTEXT TO PRESERVE:
- Focus Chain / Todo Lists: If there was a todo list, preserve all items with exact status (checked/unchecked)
- Plans: If a plan was presented to the user (especially in Plan Mode), include the key steps and requirements
- User Instructions: Any explicit user instructions or requirements they stated must be preserved

Your summary should tell the STORY of what happened, focusing on:
1. Primary Request and Intent: What was the user trying to accomplish? How did the approach evolve?
2. Key Moments: Major decisions, pivots, problems solved, and how they were resolved
3. Technical Essentials: Architecture decisions, dependencies, critical code patterns
4. Files Modified: Significant files that were changed (not just read) and WHY they were modified
5. Pending Tasks: Outstanding work that was explicitly requested
6. Task Evolution: If the task changed, document the original request and how it evolved with direct quotes
7. Current Work: What was being worked on immediately before summarization (note: recent messages will remain visible)
8. Next Step: What should happen next, with direct quotes showing where you left off
9. Required Files: Minimum files needed to continue (optional, only if applicable)

IMPORTANT GUIDELINES:
- Skip routine operations (file reads, directory listings, simple commands that didn't lead anywhere)
- Focus on the NARRATIVE flow - this should read like a story, not a checklist
- Use concrete examples rather than abstract descriptions
- For file modifications, note WHY not just WHAT
- Preserve the user's voice when they gave explicit instructions
- Target ~15-20% of the original content length while capturing 80%+ of what matters

${
	focusChainSettings?.enabled
		? `\nFocus Chain Todo List:
If a task_progress list exists, you MUST preserve it completely in your summary with exact checkbox states. This is critical for maintaining task continuity.`
		: ""
}

${
	focusChainSettings?.enabled
		? `Updating task progress:
There is an optional task_progress parameter which you should use to provide an updated checklist to keep the user informed of the latest state of the progress for this task. You should always return the most up to date version of the checklist if there is already an existing checklist. If no task_progress list was included in the previous context, you should NOT create a new task_progress list - do not return a new task_progress list if one does not already exist.`
		: ""
}

Usage:
<summarize_task>
<context>Your detailed summary</context>
${focusChainSettings?.enabled ? `<task_progress>task_progress list here</task_progress>` : ""}
</summarize_task>

Here's an example of how your output should be structured:

<example>
<thinking>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</thinking>
<summarize_task>
<context>
1. Primary Request and Intent:
   [Detailed description]
2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]
3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]
4. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]
5. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]
6. Current Work:
   [Precise description of current work]
7. Optional Next Step:
   [Optional Next step to take]
8. Optional Required Files:
   - [file path 1]
   - [file path 2]
</context>
${
	focusChainSettings?.enabled
		? `<task_progress>
- [x] Completed task example
- [x] Completed task example
- [ ] Remaining task example
- [ ] Remaining task example
</task_progress>`
		: ""
}
</summarize_task>
</example>

</explicit_instructions>\n
`
}

export const continuationPrompt = (summaryText: string) => `
This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
${summaryText}.

Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on. Pay special attention to the most recent user message when responding rather than the initial task message, if applicable.
If the most recent user's message starts with "/newtask", "/smol", "/compact", "/newrule", or "/reportbug", you should indicate to the user that they will need to run this command again.

IMPORTANT: The context was recently compacted. Do NOT compact again unless you confirm context usage is at 75% or higher. Check the environment_details section for current context window usage before considering another compaction.
`
