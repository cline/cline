import { RunScheduledTaskRequest } from "@shared/proto/cline/task"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { runScheduledTaskNow } from "./runScheduledTaskNow"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

describe("runScheduledTaskNow handler", () => {
	it("starts the queued row the view asked for", async () => {
		const runScheduledTask = vi.fn(async () => "task-2")
		const controller = { runScheduledTaskNow: runScheduledTask } as unknown as Controller

		await runScheduledTaskNow(controller, RunScheduledTaskRequest.create({ scheduledTaskId: "row-1" }))

		expect(runScheduledTask).toHaveBeenCalledWith("row-1")
	})
})
