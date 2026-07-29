import type { AgentToolContext } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { createNewTaskTool, expandNewTaskSlashCommand, NEW_TASK_TOOL_NAME } from "./vscode-new-task-tool"

const TOOL_CONTEXT = {} as AgentToolContext

describe("expandNewTaskSlashCommand", () => {
	it("expands a leading /newtask into the explicit instructions", () => {
		const result = expandNewTaskSlashCommand("/newtask")
		expect(result.expanded).toBe(true)
		expect(result.text).toContain('<explicit_instructions type="new_task">')
		expect(result.text).not.toContain("/newtask")
	})

	it("preserves the user's extra instructions after the template", () => {
		const result = expandNewTaskSlashCommand("/newtask focus on the auth refactor")
		expect(result.expanded).toBe(true)
		expect(result.text).toContain("focus on the auth refactor")
		expect(result.text.indexOf('<explicit_instructions type="new_task">')).toBe(0)
	})

	it("expands a whitespace-preceded mid-message token", () => {
		const result = expandNewTaskSlashCommand("please /newtask now")
		expect(result.expanded).toBe(true)
		expect(result.text).toContain("please")
		expect(result.text).toContain("now")
		expect(result.text).not.toContain("/newtask")
	})

	it("matches case-insensitively, like webview command validation", () => {
		expect(expandNewTaskSlashCommand("/NewTask").expanded).toBe(true)
	})

	it("does not match URLs, paths, or longer command names", () => {
		expect(expandNewTaskSlashCommand("see http://x.com/newtask").expanded).toBe(false)
		expect(expandNewTaskSlashCommand("open some/newtask file").expanded).toBe(false)
		expect(expandNewTaskSlashCommand("/newtasks").expanded).toBe(false)
	})

	it("returns unrelated text unchanged", () => {
		const result = expandNewTaskSlashCommand("hello world")
		expect(result.expanded).toBe(false)
		expect(result.text).toBe("hello world")
	})
})

describe("createNewTaskTool", () => {
	it("captures the context, completes the run, and tells the model to end its turn", async () => {
		const onNewTaskContext = vi.fn()
		const tool = createNewTaskTool({ onNewTaskContext })

		expect(tool.name).toBe(NEW_TASK_TOOL_NAME)
		expect(tool.lifecycle?.completesRun).toBe(true)

		const result = await tool.execute({ context: "  summary of work  " }, TOOL_CONTEXT)
		expect(onNewTaskContext).toHaveBeenCalledWith("summary of work")
		expect(result).toContain("End your turn")
	})

	it("rejects a missing or empty context without invoking the callback", async () => {
		const onNewTaskContext = vi.fn()
		const tool = createNewTaskTool({ onNewTaskContext })

		expect(await tool.execute({}, TOOL_CONTEXT)).toContain("Error")
		expect(await tool.execute({ context: "   " }, TOOL_CONTEXT)).toContain("Error")
		expect(onNewTaskContext).not.toHaveBeenCalled()
	})
})
