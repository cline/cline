import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"

import cloneDeep from "clone-deep"
import crypto from "crypto"
import { TodoItem, TodoStatus, todoStatusSchema } from "@roo-code/types"
import { getLatestTodo } from "../../shared/todo"

let approvedTodoList: TodoItem[] | undefined = undefined

/**
 * Add a todo item to the task's todoList.
 */
export function addTodoToTask(cline: Task, content: string, status: TodoStatus = "pending", id?: string): TodoItem {
	const todo: TodoItem = {
		id: id ?? crypto.randomUUID(),
		content,
		status,
	}
	if (!cline.todoList) cline.todoList = []
	cline.todoList.push(todo)
	return todo
}

/**
 * Update the status of a todo item by id.
 */
export function updateTodoStatusForTask(cline: Task, id: string, nextStatus: TodoStatus): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	const current = cline.todoList[idx]
	if (
		(current.status === "pending" && nextStatus === "in_progress") ||
		(current.status === "in_progress" && nextStatus === "completed") ||
		current.status === nextStatus
	) {
		cline.todoList[idx] = { ...current, status: nextStatus }
		return true
	}
	return false
}

/**
 * Remove a todo item by id.
 */
export function removeTodoFromTask(cline: Task, id: string): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	cline.todoList.splice(idx, 1)
	return true
}

/**
 * Get a copy of the todoList.
 */
export function getTodoListForTask(cline: Task): TodoItem[] | undefined {
	return cline.todoList?.slice()
}

/**
 * Set the todoList for the task.
 */
export async function setTodoListForTask(cline?: Task, todos?: TodoItem[]) {
	if (cline === undefined) return
	cline.todoList = Array.isArray(todos) ? todos : []
}

/**
 * Restore the todoList from argument or from clineMessages.
 */
export function restoreTodoListForTask(cline: Task, todoList?: TodoItem[]) {
	if (todoList) {
		cline.todoList = Array.isArray(todoList) ? todoList : []
		return
	}
	cline.todoList = getLatestTodo(cline.clineMessages)
}
/**
 * Convert TodoItem[] to markdown checklist string.
 * @param todos TodoItem array
 * @returns markdown checklist string
 */
function todoListToMarkdown(todos: TodoItem[]): string {
	return todos
		.map((t) => {
			let box = "[ ]"
			if (t.status === "completed") box = "[x]"
			else if (t.status === "in_progress") box = "[-]"
			return `${box} ${t.content}`
		})
		.join("\n")
}

function normalizeStatus(status: string | undefined): TodoStatus {
	if (status === "completed") return "completed"
	if (status === "in_progress") return "in_progress"
	return "pending"
}

function parseMarkdownChecklist(md: string): TodoItem[] {
	if (typeof md !== "string") return []
	const lines = md
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
	const todos: TodoItem[] = []
	for (const line of lines) {
		const match = line.match(/^\[\s*([ xX\-~])\s*\]\s+(.+)$/)
		if (!match) continue
		let status: TodoStatus = "pending"
		if (match[1] === "x" || match[1] === "X") status = "completed"
		else if (match[1] === "-" || match[1] === "~") status = "in_progress"
		const id = crypto
			.createHash("md5")
			.update(match[2] + status)
			.digest("hex")
		todos.push({
			id,
			content: match[2],
			status,
		})
	}
	return todos
}

export function setPendingTodoList(todos: TodoItem[]) {
	approvedTodoList = todos
}

function validateTodos(todos: any[]): { valid: boolean; error?: string } {
	if (!Array.isArray(todos)) return { valid: false, error: "todos must be an array" }
	for (const [i, t] of todos.entries()) {
		if (!t || typeof t !== "object") return { valid: false, error: `Item ${i + 1} is not an object` }
		if (!t.id || typeof t.id !== "string") return { valid: false, error: `Item ${i + 1} is missing id` }
		if (!t.content || typeof t.content !== "string")
			return { valid: false, error: `Item ${i + 1} is missing content` }
		if (t.status && !todoStatusSchema.options.includes(t.status as TodoStatus))
			return { valid: false, error: `Item ${i + 1} has invalid status` }
	}
	return { valid: true }
}

/**
 * Update the todo list for a task.
 * @param cline Task instance
 * @param block ToolUse block
 * @param askApproval AskApproval function
 * @param handleError HandleError function
 * @param pushToolResult PushToolResult function
 * @param removeClosingTag RemoveClosingTag function
 * @param userEdited If true, only show "User Edit Succeeded" and do nothing else
 */
export async function updateTodoListTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
	userEdited?: boolean,
) {
	// If userEdited is true, only show "User Edit Succeeded" and do nothing else
	if (userEdited === true) {
		pushToolResult("User Edit Succeeded")
		return
	}
	try {
		const todosRaw = block.params.todos

		let todos: TodoItem[]
		try {
			todos = parseMarkdownChecklist(todosRaw || "")
		} catch {
			cline.consecutiveMistakeCount++
			cline.recordToolError("update_todo_list")
			pushToolResult(formatResponse.toolError("The todos parameter is not valid markdown checklist or JSON"))
			return
		}

		const { valid, error } = validateTodos(todos)
		if (!valid && !block.partial) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("update_todo_list")
			pushToolResult(formatResponse.toolError(error || "todos parameter validation failed"))
			return
		}

		let normalizedTodos: TodoItem[] = todos.map((t) => ({
			id: t.id,
			content: t.content,
			status: normalizeStatus(t.status),
		}))

		const approvalMsg = JSON.stringify({
			tool: "updateTodoList",
			todos: normalizedTodos,
		})
		if (block.partial) {
			await cline.ask("tool", approvalMsg, block.partial).catch(() => {})
			return
		}
		approvedTodoList = cloneDeep(normalizedTodos)
		const didApprove = await askApproval("tool", approvalMsg)
		if (!didApprove) {
			pushToolResult("User declined to update the todoList.")
			return
		}
		const isTodoListChanged =
			approvedTodoList !== undefined && JSON.stringify(normalizedTodos) !== JSON.stringify(approvedTodoList)
		if (isTodoListChanged) {
			normalizedTodos = approvedTodoList ?? []
			cline.say(
				"user_edit_todos",
				JSON.stringify({
					tool: "updateTodoList",
					todos: normalizedTodos,
				}),
			)
		}

		await setTodoListForTask(cline, normalizedTodos)

		// If todo list changed, output new todo list in markdown format
		if (isTodoListChanged) {
			const md = todoListToMarkdown(normalizedTodos)
			pushToolResult(formatResponse.toolResult("User edits todo:\n\n" + md))
		} else {
			pushToolResult(formatResponse.toolResult("Todo list updated successfully."))
		}
	} catch (error) {
		await handleError("update todo list", error)
	}
}
