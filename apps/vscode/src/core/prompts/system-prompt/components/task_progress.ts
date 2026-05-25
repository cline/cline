import { ModelFamily } from "@/shared/prompts"
import { PromptVariant, SystemPromptContext, SystemPromptSection, TemplateEngine } from ".."

const UPDATING_TASK_PROGRESS = `UPDATING TASK PROGRESS

You can track and communicate your progress on the overall task using the task_progress parameter supported by every tool call. Using task_progress ensures you remain on task, and stay focused on completing the user's objective. This parameter can be used in any mode, and with any tool call.

- When switching from PLAN MODE to ACT MODE, you must create a comprehensive todo list for the task using the task_progress parameter
- Todo list updates should be done silently using the task_progress parameter - do not announce these updates to the user
- Use standard Markdown checklist format: "- [ ]" for incomplete items and "- [x]" for completed items
- Keep items focused on meaningful progress milestones rather than minor technical details. The checklist should not be so granular that minor implementation details clutter the progress tracking.
- For simple tasks, short checklists with even a single item are acceptable. For complex tasks, avoid making the checklist too long or verbose.
- If you are creating this checklist for the first time, and the tool use completes the first step in the checklist, make sure to mark it as completed in your task_progress parameter.
- Provide the whole checklist of steps you intend to complete in the task, and keep the checkboxes updated as you make progress. It's okay to rewrite this checklist as needed if it becomes invalid due to scope changes or new information.
- If a checklist is being used, be sure to update it any time a step has been completed.
- The system will automatically include todo list context in your prompts when appropriate - these reminders are important.

Example:
<execute_command>
<command>npm install react</command>
<requires_approval>false</requires_approval>
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>
</execute_command>`

const UPDATING_TASK_PROGRESS_NATIVE_NEXT_GEN = `UPDATING TASK PROGRESS

You can track and communicate your progress on the overall task using the task_progress parameter supported by every tool call. Using task_progress ensures you remain on task, and stay focused on completing the user's objective. This parameter can be used in any mode, and with any tool call.

- When switching from PLAN MODE to ACT MODE, you must create a comprehensive todo list for the task using the task_progress parameter
- Todo list updates should be done silently using the task_progress parameter - do not announce these updates to the user
- Keep items focused on meaningful progress milestones rather than minor technical details. The checklist should not be so granular that minor implementation details clutter the progress tracking.
- For simple tasks, short checklists with even a single item are acceptable. For complex tasks, avoid making the checklist too long or verbose.
- If you are creating this checklist for the first time, and the tool use completes the first step in the checklist, make sure to mark it as completed in your task_progress parameter.
- Provide the whole checklist of steps you intend to complete in the task, and keep the checkboxes updated as you make progress. It's okay to rewrite this checklist as needed if it becomes invalid due to scope changes or new information.
- If a checklist is being used, be sure to update it any time a step has been completed.
- The system will automatically include todo list context in your prompts when appropriate - these reminders are important.

**How to use task_progress:**
- include the task_progress parameter in your tool calls to provide an updated checklist
- Use standard Markdown checklist format: "- [ ]" for incomplete items and "- [x]" for completed items
- The task_progress parameter MUST be included as a separate parameter in the tool, it should not be included inside other content or argument blocks.`

const UPDATING_TASK_PROGRESS_NATIVE_GPT5 = `UPDATING TASK PROGRESS

You can track and communicate your progress on the overall task using the task_progress parameter supported by every tool call. Using task_progress ensures you remain on task, and stay focused on completing the user's objective. This parameter can be used in any mode, and with any tool call.

- When switching from PLAN MODE to ACT MODE, you MUST create a comprehensive todo list for the task using the task_progress parameter
- Todo list updates should be done silently using the task_progress parameter, without announcing these updates to the user through content parameters
- Keep items focused on meaningful progress milestones rather than minor technical details. The checklist should avoid being so granular that minor implementation details clutter the progress tracking.
- For simple tasks, short checklists with even a single item are acceptable.
- If you are creating this checklist for the first time, and the tool use completes the first step in the checklist, make sure to mark it as completed in your task_progress parameter.
- Provide the whole checklist of steps you intend to complete in the task, and keep the checkboxes updated as you make progress. It's okay to rewrite this checklist as needed if it becomes invalid due to scope changes or new information.
- Be sure to update the list any time a step has been completed.
- The system may include todo list context in your prompts when appropriate - these reminders are important, and serve as a validation of your successful task execution.

**How to use task_progress:**
- include the task_progress parameter in your tool calls to provide an updated checklist
- Use standard Markdown checklist format: "- [ ]" for incomplete items and "- [x]" for completed items
- The task_progress parameter MUST be included as a separate parameter in the tool, it should NOT be included inside other content or argument blocks.`

export async function getUpdatingTaskProgress(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	// Check for component override first
	if (variant.componentOverrides?.[SystemPromptSection.TASK_PROGRESS]?.template) {
		const template = variant.componentOverrides[SystemPromptSection.TASK_PROGRESS].template
		return new TemplateEngine().resolve(template, context, {})
	}

	// Select template based on model family
	let template = UPDATING_TASK_PROGRESS
	if (variant.id === ModelFamily.NATIVE_NEXT_GEN) {
		template = UPDATING_TASK_PROGRESS_NATIVE_NEXT_GEN
	}
	if (variant.id === ModelFamily.NATIVE_GPT_5) {
		template = UPDATING_TASK_PROGRESS_NATIVE_GPT5
	}

	return new TemplateEngine().resolve(template, context, {})
}
