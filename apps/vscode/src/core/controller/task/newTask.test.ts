import { NewTaskRequest } from "@shared/proto/cline/task"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { newTask } from "./newTask"

function makeController() {
	const initTask = vi.fn().mockResolvedValue("task-1")
	const controller = {
		initTask,
		stateManager: { getGlobalSettingsKey: () => ({ actions: {} }) },
	} as unknown as Controller
	return { controller, initTask }
}

describe("newTask execution target", () => {
	it("refuses a cloud request that names no repository instead of starting locally", async () => {
		const { controller, initTask } = makeController()

		await expect(
			newTask(controller, NewTaskRequest.create({ text: "hello", executionTarget: "cloud", cloudRepoUrl: "  " })),
		).rejects.toThrow("Choose a GitHub repository")
		expect(initTask).not.toHaveBeenCalled()
	})

	it("passes the cloud target through when the repository is set", async () => {
		const { controller, initTask } = makeController()

		await newTask(
			controller,
			NewTaskRequest.create({
				text: "hello",
				executionTarget: "cloud",
				cloudRepoUrl: "https://github.com/cline/fixture",
				cloudBranch: "main",
			}),
		)

		expect(initTask).toHaveBeenCalledWith("hello", [], [], undefined, expect.any(Object), {
			repoUrl: "https://github.com/cline/fixture",
			branch: "main",
		})
	})

	it("starts locally when no execution target is given", async () => {
		const { controller, initTask } = makeController()

		await newTask(controller, NewTaskRequest.create({ text: "hello" }))

		expect(initTask).toHaveBeenCalledWith("hello", [], [], undefined, expect.any(Object), undefined)
	})
})
