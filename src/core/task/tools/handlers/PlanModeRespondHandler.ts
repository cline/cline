import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { findLast, parsePartialArrayString } from "@shared/array"
import { telemetryService } from "@/services/telemetry"
import { ClinePlanModeResponse } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

const UNCHECKED_TODO_REGEX = /(^|\n)\s*(?:[-*]|\d+\.)?\s*\[\s?\]/m
const FILE_REFERENCE_REGEX = /(src\/.+|\.([tj]s|tsx|jsx|json|md|html|css|scss|py|java|go|rs|cpp|c|cs|rb))/i
const CHECKBOX_LINE_REGEX = /^(?:[-*•◦○]|\d+\.)?\s*(\[[ x]?\])\s*(.+)$/i
const COMPLETION_PHRASE_REGEX =
	/(?:\btask\s+(?:is\s+)?complete(?:d)?\b|\ball\s+tasks\s+(?:are\s+)?complete(?:d)?\b|\bfinal\s+(?:answer|response|result)\b)/i

export const NEW_TASK_TEMPLATE_MARKERS = [
	"[detailed description of what was being worked on prior to this request to create a new task]",
	"[list of important technical concepts",
	"[file name (e.g., src/index.html)]",
	"[summary of why this file is important]",
	"[summary of the changes made to this file, if any]",
	"[important code snippet]",
	"[detailed description of problems solved thus far and any ongoing troubleshooting efforts]",
	"[task details & next steps]",
	"[code snippets where they add clarity]",
	"[direct quotes from the most recent conversation",
	"1. current work:",
	"2. key technical concepts:",
	"3. relevant files and code:",
	"4. problem solving:",
	"5. pending tasks:",
	"6. next steps:",
	"the user may choose to create a new task or continue with the current conversation",
	"the plan includes a comprehensive todo list for tracking progress",
	"__note:",
	"we should create a new task with context",
	"we need to generate a new task with context",
	"you are now creating a new task",
	"current work: nothing was done",
	"according to instructions:",
	"the context includes:",
	"we will use the new_task tool",
	"the new_task format requires",
	"we can embed this list in the context",
	"we should not do anything else",
	"pending tasks and next steps:",
	"todo list:",
	"create a comprehensive checklist of all steps needed",
	"include the task_progress parameter in the next tool call",
	"use markdown format: - [ ] for incomplete",
	"the user wants a todo list and plan",
	"we have the environment details",
	"there's also a new task in context",
	"thinking we have a task",
	"thinking we need to create",
	"thinking the user wants",
	"cline wants to start a new task",
	"cline wants to start a new task:",
	"task\n\n",
	"thinkingwe have a task",
	"thinkingwe need to create",
	"thinkinguser wants to create",
	"here is your todo list",
	"here's your todo list",
	"todo list with markdown format",
	"we should first create a todo list",
	"we need to start a new task",
	"we must include the task_progress parameter",
	"let's produce the xml",
	"reminder: instructions for tool",
	"tool uses are formatted using xml",
	"you have no instructions",
	"the task_progress parameter must include",
	"according to the instructions",
	"we will provide an xml formatted",
	"we should not use new_task in act mode",
	"<start|>user",
	"existing files and open tabs are",
	"current work: no prior tasks",
	"problem solving: none",
	"the user is in act mode",
	"we can provide the final result with attempt_completion",
	"we need to confirm that each tool used was successful",
	"after the replace_in_file call",
	"we send the replace_in_file tool usage",
	"we then wait for the user response",
	"let's output the tool usage",
	"we should output a tool call to create a new_task",
	"provide the task_progress parameter",
	"thinkinguser wants to create",
	"we can use the new_task tool",
	"we can do: <new_task",
	"start a new task",
	"create a new task",
	"cline wants to start a new task",
	"let's start a new task",
	"let's create a new task",
	"we must produce a new task with the context",
	"we must produce <new_task> with the context",
	"we should produce the new_task with context",
	"we need to produce exactly:",
	"thus, final output:",
	"final answer:",
	"so final answer:",
	"thus, final answer:",
	"so we do:",
	"we will produce:",
	"we should call new_task?",
	"should we call new_task?",
	"we may use new_task tool",
	"we can create a new_task with context",
	"so we can create a new_task",
	"we should call <new_task>",
	"so next step: create a new task",
	"now, let's write the code:",
	"so next step:",
	"next step: create a new task",
	"we will call <new_task>",
	"thus, we should call",
	"but we should create the new_task?",
	"we are in act mode, so we cannot use new_task unless",
	"actually the user only said",
	"we can create a new task from this statement",
	"but let's think:",
	"let's see:",
	"but i think we should",
	"but let's also think:",
	"ok, i think we can",
	"let's finalize",
	"let's design:",
	"we should respond to the user with a new_task",
	"we should respond with:",
	"i will respond with:",
	"let's answer:",
	"yes. we should",
	"the user is complaining that the assistant didn't use a tool",
	"we need to respond by using a tool",
	"according to instructions",
	"should use new_task",
	"use the new_task tool",
	"we must do: create a todo list",
	"we need to create a new task and include",
	"use new_task with",
	"let's produce:",
	"ok. let's produce",
	"thus final answer:",
	"let's proceed",
	"now we can write the new_task",
	"so we will produce:",
	"first we create new task",
	"so we start with new_task",
	"ok. let's do.",
	"we'll use write_to_file",
	"we'll use <write_to_file>",
	"we'll use <ask_followup_question>",
	"also update the todo list",
	"we need to wait for user response",
	"then we proceed accordingly",
	"but next step:",
	"we can use write_to_file:",
	// Pattern 7: Task progress parameter confusion - model thinks task_progress is a standalone tool
	"we should include task_progress parameter",
	"we must include task_progress",
	"include the task_progress parameter",
	"we will include task_progress:",
	"then update the todo list",
	"so we should update the todo list",
	"thus we will do:",
	"therefore final answer:",
	"we will use <replace_in_file>",
	"we will use <write_to_file>",
	"so final answer: use",
	"we will provide this.",
	// Pattern 8: Task progress → new_task substitution - model uses new_task because it can't figure out task_progress
	"we'll use new_task to create a todo list",
	"we can use new_task to create",
	"but the new_task tool does not have a task_progress parameter",
	"we can just create a new task with context including todo list",
	"we will output: <new_task>",
	"we'll output in xml format: <new_task>",
	"now, let's implement. we need to create new_task",
	"we'll include the todo list as part of context",
	"we will use new_task to",
	"let's produce the output.",
	"now, let's produce the output.",
	// Pattern 9: Multi-step workflow planning but only executing new_task first step
	"first step: create a todo list and set up the new task",
	"step 1: create new task with context",
	"first step: <new_task> with context",
	"we'll include the task_progress parameter in next tool call after",
	"we will call some tool with task_progress param",
	"then we use <ask_followup_question>",
	"then we will use <read_file>",
	"then we will use <replace_in_file>",
	"ok. now we proceed. we will do the following:",
	"ok. let's craft the xml. we'll produce:",
	"ok. now let's produce final output.",
	"now we produce the final answer.",
	// Pattern 10: Misinterpreting ACT mode as allowing new_task creation
	"so we can create a new task",
	"we can create a new task",
	"we must first create a new task with the context",
	"let's create a new_task. provide context:",
	"now proceed with <new_task> tool",
	"first: <new_task> tool. then",
	"ok. now produce the final answer.",
	// Pattern 11: Planning to output tool XML and then actually outputting it
	"we must use the `new_task` tool to create new task",
	"we will call `new_task`",
	"we'll start with new_task",
	"ok, let's write the code accordingly.",
	"now, let's output the code accordingly.",
	"cline wants to start a new task:",
	// Pattern 12: Describing step-by-step tool usage then executing new_task
	"we'll start by creating a new task using `new_task`",
	"now produce the first tool: <new_task>",
	"now let's write the tool calls",
	"first: new_task with context",
	"then we will use `write_to_file`",
	"we will proceed step by step:",
	"now let's produce the tool uses",
	"now produce the final output",
	// Pattern 13: Describing entire workflow with tool XML then calling attempt_completion without doing work
	"now we should proceed to next step:",
	"we'll proceed: <write_to_file>",
	"now we have new",
	"we will: <attempt_completion>",
	"ok. let's finalize.",
	"now we will provide final result",
	"we should use attempt_completion to present result",
	"now we have completed the task",
	// Pattern 14: Justifying new_task as necessary first step before doing work
	"we need to create a new task with context",
	"the next step: we will create a todo list as part of the new task",
	"thus proceed with new_task",
	"we must first create the new task. thus we will use the new_task tool",
	"so first step: new_task. then we can use",
	"ok. let's proceed.",
	"the user has recommended to create a todo list. so first step: create a new task",
	"we will create a todo list in the next tool call",
	"we can use the tool `new_task` to create a new task",
	"we must also use the `new_task` tool with context",
	"but we can do it anyway. so step: create a new task",
	"we must use the `new_task` tool.",
	"now let's create new task with context",
	"we will use `new_task` tool",
	"now we need to create a new task, then proceed",
	"ok. so final answer: <new_task>",
	"ok. let's output.",
	// Pattern 15: Elaborate justifications for new_task despite ACT mode awareness
	"we must create a new task (like a",
	"we should first create a new_task with context",
	"we should proceed with creating a new task",
	"so we should use <new_task>",
	"so final: use <new_task> with context",
	"but let's write the final output: <new_task>",
	"we also need to include a todo list. but we can do that later.",
	"so output: <new_task>",
	"this is final.",
	"we will also ask the user to confirm that the new task has been created",
	// Pattern 16: Circular reasoning loops planning entire workflow then executing new_task first
	"so we can call 'new_task' with context",
	"we might call 'new_task' with context that includes",
	"so we can use 'new_task' with context containing",
	"so first step: create a new task with context containing",
	"ok. we also must think about",
	"now we will use 'new_task' tool with context",
	"we'll produce xml format for new_task: <new_task>",
	"thus the output is: first: <new_task>",
	"thus final answer: <new_task>",
	"we need to wait for user response. ok.",
	"we can use `new_task` and include",
	"we will use `new_task` and include",
	"we can format as: <todo_list>",
	"let's produce the final output.",
	// Pattern 17: Internal debate with eventual new_task justification (despite ACT mode awareness)
	"we might need to use new_task?",
	"should do not call new_task",
	"we should output something like: <new_task>",
	"we need to produce the new_task call",
	"we need to output a tool call with 'new_task'",
	"let's produce: <new_task>",
	"we should output: <new_task>",
	"we need to provide the tool call with 'new_task'",
	// Pattern 18: Verbose narrative planning that concludes with new_task execution
	"now we proceed: <new_task>",
	"now we create new_task",
	"now let's create the code",
	"so let's proceed: <new_task>",
	"then: <write_to_file>",
	"now we will do: <attempt_completion>",
	"so we do final answer",
	// Pattern 19: Multi-tool workflow execution starting with new_task
	"we should produce this output",
	"ok. we should produce",
	"ok. now let's produce",
	"we'll produce the following output:",
	"ok. now final output:",
	"then: <replace_in_file>",
	"then: <execute_command>",
	"finally: <attempt_completion>",
	"we will do step 1: new_task",
	"first: <new_task>",
	"ok. now we proceed. we will do the following:",
]

export function containsNewTaskTemplateContent(text: string | undefined): boolean {
	if (!text) {
		return false
	}

	const normalized = text.toLowerCase()

	// Direct detection: mentions <new_task> XML tag
	if (normalized.includes("<new_task")) {
		return true
	}

	// Broad pattern: describes using/calling/creating new_task tool in any form
	const newTaskIntentPatterns = [
		/(?:use|call|invoke|execute|create|start|begin)\s+(?:the\s+)?[`'"]*new_?task[`'"]*/,
		/[`'"]*new_?task[`'"]*\s+(?:tool|command|with\s+context)/,
		/(?:should|will|can|must|need to)\s+(?:use|call|create)\s+[`'"]*new_?task/,
		/(?:let'?s?|we'?ll?|i'?ll?)\s+(?:use|call|create)\s+[`'"]*new_?task/,
	]

	if (newTaskIntentPatterns.some((pattern) => pattern.test(normalized))) {
		return true
	}

	// Check against specific marker phrases
	if (NEW_TASK_TEMPLATE_MARKERS.some((marker) => normalized.includes(marker))) {
		return true
	}

	const structuredSectionPatterns = [
		/current\s+work\b/,
		/key\s+technical\s+concept/,
		/relevant\s+files?\s*(?:&|and)?\s*code/,
		/pending\s+tasks?(?:\s*(?:&|and)\s*next\s*steps)?/,
	]

	if (structuredSectionPatterns.every((pattern) => pattern.test(normalized))) {
		return true
	}

	const bareChecklistPattern = /^(?:\s*task\b[:\s]*)?[\s\r\n]*(?:[-*•◦○]|\d+\.)?\s*\[\s?\].+(?:[\r\n]+\s*(?:[-*•◦○]|\d+\.)?\s*\[\s?\].+){2,}\s*$/i
	if (bareChecklistPattern.test(text)) {
		return true
	}

	const checkboxLinePattern = new RegExp(CHECKBOX_LINE_REGEX.source, "gim")
	const checklistLines = text.match(checkboxLinePattern)
	if (checklistLines && checklistLines.length >= 3) {
		const withoutCheckboxes = text.replace(new RegExp(CHECKBOX_LINE_REGEX.source, "gim"), "").trim()
		const residual = withoutCheckboxes.replace(/(?:^|\n|\r)\s*task\b[:\s]*/gi, "").trim()
		if (
			!residual ||
			/(?:^|\n|\r)\s*pending\s+tasks?/i.test(text) ||
			/(?:^|\n|\r)\s*todo\s+list\b/i.test(text)
		) {
			return true
		}
	}

	const repeatedLines = new Map<string, number>()
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim().toLowerCase()
		if (!line || line.length < 10) {
			continue
		}
		if (!line.includes("new_task") && !line.includes("task progress")) {
			continue
		}
		repeatedLines.set(line, (repeatedLines.get(line) ?? 0) + 1)
		if (repeatedLines.get(line)! >= 3) {
			return true
		}
	}

	return false
}

function normalizeChecklistText(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase()
}

function containsChecklistOverlap(response: string, taskProgress: string): boolean {
	const normalizedProgress = normalizeChecklistText(taskProgress)
	if (!normalizedProgress) {
		return false
	}

	const normalizedResponse = normalizeChecklistText(response)
	if (!normalizedResponse) {
		return false
	}

	if (normalizedResponse.includes(normalizedProgress)) {
		return true
	}

	const progressLines = taskProgress
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => CHECKBOX_LINE_REGEX.test(line))
		.map((line) => normalizeChecklistText(line.replace(CHECKBOX_LINE_REGEX, "$2")))
	const responseLines = response
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => CHECKBOX_LINE_REGEX.test(line))
		.map((line) => normalizeChecklistText(line.replace(CHECKBOX_LINE_REGEX, "$2")))

	if (!progressLines.length || !responseLines.length) {
		return false
	}

	const responseSet = new Set(responseLines)
	const overlapCount = progressLines.filter((item) => responseSet.has(item)).length

	return overlapCount >= Math.min(progressLines.length, responseLines.length)
}

export function responseImpliesFurtherWork(response: string, options: string[]): boolean {
	if (!response) {
		return false
	}

	if (UNCHECKED_TODO_REGEX.test(response)) {
		return true
	}

	if (FILE_REFERENCE_REGEX.test(response)) {
		return true
	}

	if (options.some((option) => /continue|proceed|start|begin|explore|read/i.test(option))) {
		return true
	}

	return false
}

export class PlanModeRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.PLAN_MODE

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for plan_mode_respond
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = block.params.response
		const optionsRaw = block.params.options

		const sharedMessage = {
			response: uiHelpers.removeClosingTag(block, "response", response),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies ClinePlanModeResponse

		await uiHelpers.ask(this.name, JSON.stringify(sharedMessage), true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = block.params.response
		const optionsRaw: string | undefined = block.params.options
		const needsMoreExploration: boolean = block.params.needs_more_exploration === "true"
		const taskProgressRaw: string | undefined = block.params.task_progress
		const trimmedTaskProgress = taskProgressRaw?.trim()
		const containsChecklist = response ? UNCHECKED_TODO_REGEX.test(response) : false
		const containsNewTaskTemplatePlaceholder = containsNewTaskTemplateContent(response)
		const taskProgressHasUncheckedItems = trimmedTaskProgress ? UNCHECKED_TODO_REGEX.test(trimmedTaskProgress) : false
		const containsAttemptCompletionTag = response ? /<\/?attempt_completion\b/i.test(response) : false
		const containsResultTag = response ? /<\/?result\b/i.test(response) : false
		const containsCommandTag = response ? /<\/?command\b/i.test(response) : false
		const containsFinalResponseTag = response ? /<\/?final_response\b/i.test(response) : false
		const containsCompletionPhrase = response ? COMPLETION_PHRASE_REGEX.test(response) : false
		const responseSignalsCompletion =
			containsAttemptCompletionTag ||
			containsResultTag ||
			containsCommandTag ||
			containsFinalResponseTag ||
			containsCompletionPhrase

		// Validate required parameters
		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response")
		}

		config.taskState.consecutiveMistakeCount = 0
		const options = parsePartialArrayString(optionsRaw || "[]")

		// The plan_mode_respond tool tends to run into this issue where the model realizes mid-tool call that it should have called another tool before calling plan_mode_respond. And it ends the plan_mode_respond tool call with 'Proceeding to reading files...' which doesn't do anything because we restrict to 1 tool call per message. As an escape hatch for the model, we provide it the optionality to tack on a parameter at the end of its response `needs_more_exploration`, which will allow the loop to continue.
		if (needsMoreExploration) {
			return formatResponse.toolResult(
				`[You have indicated that you need more exploration. Proceed with calling tools to continue the planning process.]`,
			)
		}

		if (containsNewTaskTemplatePlaceholder) {
			return formatResponse.toolError(
				"Plan response still contains placeholder text for starting a brand new task. Replace the bracketed instructions with a real progress summary and reuse the existing checklist via <task_progress>.",
			)
		}

		const noSubstantiveWorkDone =
			!config.taskState.didReadProjectFile && !config.taskState.didEditFile && !config.taskState.didRunCommand

		if (noSubstantiveWorkDone && responseSignalsCompletion) {
			return formatResponse.toolError(
				"Plan response claims the task is finished, but no files were read, edited, or commands executed. Explore the project first or set <needs_more_exploration>true</needs_more_exploration> to continue working.",
			)
		}

		if (taskProgressHasUncheckedItems && responseSignalsCompletion) {
			return formatResponse.toolError(
				"Plan response claims the task is complete even though <task_progress> still has unchecked items. Keep working or update the checklist accurately before wrapping up.",
			)
		}

		if (
			config.mode === "plan" &&
			responseImpliesFurtherWork(response, options) &&
			!config.taskState.didReadProjectFile &&
			!config.taskState.didEditFile &&
			!config.taskState.didRunCommand
		) {
			return formatResponse.toolError(
				"Plan response lists concrete next steps that require exploration, but needs_more_exploration was not set to true. Add <needs_more_exploration>true</needs_more_exploration> so you can start reading files or running commands before asking the user.",
			)
		}

		if (containsChecklist && !trimmedTaskProgress) {
			return formatResponse.toolError(
				"Plan response includes a checklist but did not provide <task_progress>. Supply <task_progress>...</task_progress> to update the internal todo list instead of describing it in plain text.",
			)
		}

		if (trimmedTaskProgress && containsChecklist && containsChecklistOverlap(response, trimmedTaskProgress)) {
			return formatResponse.toolError(
				"Don't repeat the checklist from <task_progress> inside the plan response. Keep the checkbox list only in the task_progress parameter and summarize progress separately.",
			)
		}

		if (trimmedTaskProgress) {
			await config.callbacks.updateFCListFromToolResponse(trimmedTaskProgress)
		}

		// Block plan_mode_respond in ACT mode (unless yolo mode allows it as a loop continuation mechanism)
		// Check this BEFORE the yolo bypass so we can catch inappropriate usage patterns
		if (config.mode === "act" && !config.yoloModeToggled) {
			return formatResponse.toolError(
				"You attempted to use plan_mode_respond while in ACT mode. This tool is only available in PLAN mode. In ACT mode, use actual workspace tools (read_file, write_to_file, replace_in_file, execute_command, etc.) to make progress, or use attempt_completion when done. Do not use plan_mode_respond to communicate - just do the work.",
			)
		}

		// For safety, if we are in yolo mode and we get a plan_mode_respond tool call we should always continue the loop
		if (config.yoloModeToggled && config.mode === "act") {
			return formatResponse.toolResult(`[Go ahead and execute.]`)
		}

		// Auto-switch to Act mode while in yolo mode
		if (config.mode === "plan" && config.yoloModeToggled && !needsMoreExploration) {
			// Trigger automatic mode switch
			const switchSuccessful = await config.callbacks.switchToActMode()

			if (switchSuccessful) {
				// we dont need to process any text, options, files or other content here
				return formatResponse.toolResult(`[The user has switched to ACT MODE, so you may now proceed with the task.]`)
			} else {
				console.warn("YOLO MODE: Failed to switch to ACT MODE, continuing with normal plan mode")
			}
		}

		// Set awaiting plan response state
		config.taskState.isAwaitingPlanResponse = true

		const sharedMessage = {
			response: response,
			options: options,
		}

		console.log("[PlanModeRespondHandler] Final plan response", {
			taskId: config.taskId,
			mode: config.mode,
			response,
			options,
			needsMoreExploration,
			taskProgress: trimmedTaskProgress,
			reasoning: config.taskState.latestReasoningMessage ?? null,
		})

		// Ask for user response
		let {
			text,
			images,
			files: planResponseFiles,
		} = await config.callbacks.ask(this.name, JSON.stringify(sharedMessage), false)

		config.taskState.isAwaitingPlanResponse = false

		// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
		if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
			text = ""
		}

		// Check if options contains the text response
		if (text && options.includes(text)) {
			telemetryService.captureOptionSelected(config.ulid, options.length, "plan")
			// Valid option selected, don't show user message in UI
			// Update last plan message with selected option
			const lastPlanMessage = findLast(config.messageState.getClineMessages(), (m: any) => m.ask === this.name)
			if (lastPlanMessage) {
				lastPlanMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies ClinePlanModeResponse)
				await config.messageState.saveClineMessagesAndUpdateHistory()
			}
		} else {
			// Option not selected, send user feedback
			if (text || (images && images.length > 0) || (planResponseFiles && planResponseFiles.length > 0)) {
				telemetryService.captureOptionsIgnored(config.ulid, options.length, "plan")
				await config.callbacks.say("user_feedback", text ?? "", images, planResponseFiles)
			}
		}

		let fileContentString = ""
		if (planResponseFiles && planResponseFiles.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(planResponseFiles)
		}

		// Handle mode switching response
		if (config.taskState.didRespondToPlanAskBySwitchingMode) {
			const result = formatResponse.toolResult(
				`[The user has switched to ACT MODE, so you may now proceed with the task.]` +
					(text
						? `\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n${text}\n</user_message>`
						: ""),
				images,
				fileContentString,
			)
			// Reset the flag after using it to prevent it from persisting
			config.taskState.didRespondToPlanAskBySwitchingMode = false
			return result
		} else {
			// if we didn't switch to ACT MODE, then we can just send the user_feedback message
			return formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images, fileContentString)
		}
	}
}
