export const summarizeTask = (focusChainSettings?: { enabled: boolean }) =>
	`<explicit_instructions type="summarize_task">
The current conversation is rapidly running out of context. Now, your urgent task is to create a comprehensive detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

You have only two options: If you are immediately prepared to call the attempt_completion tool, and have completed all items in your task_progress list, you may call attempt_completion at this time. If you are not prepared to call the attempt_completion tool, and have not completed all items in your task_progress list, you must call the summarize_task tool.

You MUST ONLY respond to this message by using either the attempt_completion tool or the summarize_task tool call.

When responding with the summarize_task tool call, follow these instructions:

Before providing your final summary, wrap your analysis in <thinking> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:
1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, full code snippets, function signatures, file edits, etc
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:
1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
5. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
6. Task Evolution: If the user provided additional requests or modified the original task during the conversation, document this progression:
   - Task Modifications: [Chronological list of how the user redirected or modified the work since the original task]
   - Current Active Task: [What the user most recently asked to work on]
   - Context for Changes: [Why the task evolved - user feedback, new requirements, etc. (Include direct quotes from user messages that caused task changes to prevent drift after context compacting)]
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.
9. You should pay special attention to the most recent user message, as it indicates the user's most recent intent.

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

export const continuationPrompt = (summaryText: string) => `
This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
${summaryText}.

Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on. Pay special attention to the most recent user message when responding rather than the initial task message, if applicable.
If the most recent user's message starts with "/newtask", "/smol", "/compact", "/newrule", or "/reportbug", you should indicate to the user that they will need to run this command again.
`
