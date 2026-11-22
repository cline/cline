import { PlanActMode } from "@shared/proto/cline/state"
import { ScheduledTask as ScheduledTaskProto, UpdateScheduledTasksRequest } from "@shared/proto/cline/task"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { updateScheduledTasks } from "./updateScheduledTasks"

function makeController(currentMode: "plan" | "act" = "act") {
	const updateScheduledTasksOnController = vi.fn(async () => undefined)
	const controller = {
		updateScheduledTasks: updateScheduledTasksOnController,
		stateManager: { getGlobalSettingsKey: () => currentMode },
	} as unknown as Controller
	return { controller, updateScheduledTasksOnController }
}

function request(tasks: ScheduledTaskProto[], paused?: boolean) {
	return UpdateScheduledTasksRequest.create({ tasks, paused })
}

describe("updateScheduledTasks handler", () => {
	it("keeps the queue in the order the view sent it, pin per row", async () => {
		const { controller, updateScheduledTasksOnController } = makeController()

		await updateScheduledTasks(
			controller,
			request([
				ScheduledTaskProto.create({
					id: "row-1",
					message: "Add the tests",
					mode: PlanActMode.PLAN,
					includeSummary: true,
					providerId: "openrouter",
					modelId: "anthropic/claude-sonnet-4-5",
					createdAt: 1_700_000_000_000,
				}),
				ScheduledTaskProto.create({
					id: "row-2",
					message: "Write the changelog",
					mode: PlanActMode.ACT,
					includeSummary: false,
					createdAt: 1_700_000_000_001,
				}),
			]),
		)

		expect(updateScheduledTasksOnController).toHaveBeenCalledWith(
			[
				{
					id: "row-1",
					message: "Add the tests",
					mode: "plan",
					includeSummary: true,
					providerId: "openrouter",
					modelId: "anthropic/claude-sonnet-4-5",
					createdAt: 1_700_000_000_000,
				},
				{
					id: "row-2",
					message: "Write the changelog",
					mode: "act",
					includeSummary: false,
					createdAt: 1_700_000_000_001,
				},
			],
			undefined,
		)
	})

	it("gives a row an id it can be edited and deleted by", async () => {
		const { controller, updateScheduledTasksOnController } = makeController()

		await updateScheduledTasks(controller, request([ScheduledTaskProto.create({ message: "No id yet" })]))

		const [tasks] = updateScheduledTasksOnController.mock.calls[0] as unknown as [Array<{ id: string }>]
		expect(tasks[0]?.id).toMatch(/^scheduled-/)
	})

	it("inherits the mode the user is in when a row has none, and drops a blank model pin", async () => {
		const { controller, updateScheduledTasksOnController } = makeController("plan")

		await updateScheduledTasks(
			controller,
			request([ScheduledTaskProto.create({ id: "row-1", message: "Plan next", providerId: "anthropic", modelId: "  " })]),
		)

		expect(updateScheduledTasksOnController).toHaveBeenCalledWith(
			[
				{
					id: "row-1",
					message: "Plan next",
					mode: "plan",
					includeSummary: true,
					providerId: "anthropic",
					createdAt: expect.any(Number),
				},
			],
			undefined,
		)
	})

	it("carries the pause flag without touching the queue when only pausing changed", async () => {
		const { controller, updateScheduledTasksOnController } = makeController()

		await updateScheduledTasks(controller, request([], true))

		expect(updateScheduledTasksOnController).toHaveBeenCalledWith([], true)
	})

	it("drops duplicate rows so the same chat cannot run twice", async () => {
		const { controller, updateScheduledTasksOnController } = makeController()

		await updateScheduledTasks(
			controller,
			request([
				ScheduledTaskProto.create({ id: "row-1", message: "One", mode: PlanActMode.ACT, includeSummary: false }),
				ScheduledTaskProto.create({ id: "row-1", message: "One again", mode: PlanActMode.ACT, includeSummary: false }),
			]),
		)

		const [tasks] = updateScheduledTasksOnController.mock.calls[0] as unknown as [Array<{ message: string }>]
		expect(tasks.map((task) => task.message)).toEqual(["One"])
	})
})
