import delay from "delay"
import * as vscode from "vscode"

import { RooCodeEventName, TodoItem } from "@roo-code/types"

import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Task } from "../task/Task"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { parseMarkdownChecklist } from "./updateTodoListTool"
import { Package } from "../../shared/package"

export async function newTaskTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const mode: string | undefined = block.params.mode
	const message: string | undefined = block.params.message
	const todos: string | undefined = block.params.todos

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				tool: "newTask",
				mode: removeClosingTag("mode", mode),
				content: removeClosingTag("message", message),
				todos: removeClosingTag("todos", todos),
			})

			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			// Validate required parameters
			if (!mode) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("new_task")
				pushToolResult(await cline.sayAndCreateMissingParamError("new_task", "mode"))
				return
			}

			if (!message) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("new_task")
				pushToolResult(await cline.sayAndCreateMissingParamError("new_task", "message"))
				return
			}

			// Get the VSCode setting for requiring todos
			const provider = cline.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}
			const state = await provider.getState()

			// Use Package.name (dynamic at build time) as the VSCode configuration namespace.
			// Supports multiple extension variants (e.g., stable/nightly) without hardcoded strings.
			const requireTodos = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("newTaskRequireTodos", false)

			// Check if todos are required based on VSCode setting
			// Note: undefined means not provided, empty string is valid
			if (requireTodos && todos === undefined) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("new_task")
				pushToolResult(await cline.sayAndCreateMissingParamError("new_task", "todos"))
				return
			}

			// Parse todos if provided, otherwise use empty array
			let todoItems: TodoItem[] = []
			if (todos) {
				try {
					todoItems = parseMarkdownChecklist(todos)
				} catch (error) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("new_task")
					pushToolResult(formatResponse.toolError("Invalid todos format: must be a markdown checklist"))
					return
				}
			}

			cline.consecutiveMistakeCount = 0
			// Un-escape one level of backslashes before '@' for hierarchical subtasks
			// Un-escape one level: \\@ -> \@ (removes one backslash for hierarchical subtasks)
			const unescapedMessage = message.replace(/\\\\@/g, "\\@")

			// Verify the mode exists
			const targetMode = getModeBySlug(mode, state?.customModes)

			if (!targetMode) {
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
				return
			}

			const toolMessage = JSON.stringify({
				tool: "newTask",
				mode: targetMode.name,
				content: message,
				todos: todoItems,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Provider is guaranteed to be defined here due to earlier check

			if (cline.enableCheckpoints) {
				cline.checkpointSave(true)
			}

			// Preserve the current mode so we can resume with it later.
			cline.pausedModeSlug = (await provider.getState()).mode ?? defaultModeSlug

			// Create new task instance first (this preserves parent's current mode in its history)
			const newCline = await provider.createTask(unescapedMessage, undefined, cline, {
				initialTodos: todoItems,
			})
			if (!newCline) {
				pushToolResult(t("tools:newTask.errors.policy_restriction"))
				return
			}

			// Now switch the newly created task to the desired mode
			await provider.handleModeSwitch(mode)

			// Delay to allow mode change to take effect
			await delay(500)

			cline.emit(RooCodeEventName.TaskSpawned, newCline.taskId)

			pushToolResult(
				`Successfully created new task in ${targetMode.name} mode with message: ${unescapedMessage} and ${todoItems.length} todo items`,
			)

			// Set the isPaused flag to true so the parent
			// task can wait for the sub-task to finish.
			cline.isPaused = true
			cline.emit(RooCodeEventName.TaskPaused)

			return
		}
	} catch (error) {
		await handleError("creating new task", error)
		return
	}
}
