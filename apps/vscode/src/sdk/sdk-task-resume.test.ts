import { describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { type PrepareTaskResumeStartDeps, prepareTaskResumeStartInput } from "./sdk-task-resume"

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
	const tempHost = { dispose: vi.fn().mockResolvedValue(undefined) }
	const deps = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as unknown as StateManager,
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({ modelId: "claude", sessionId: undefined as string | undefined }),
		},
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "sdk" }]),
		...overrides,
	} as unknown as PrepareTaskResumeStartDeps & {
		taskHistory: {
			findHistoryItem: ReturnType<typeof vi.fn>
			isLegacyTask: ReturnType<typeof vi.fn>
			getLegacyResumeInitialMessages: ReturnType<typeof vi.fn>
		}
		loadInitialMessages: ReturnType<typeof vi.fn>
	}
	return { deps, tempHost }
}

describe("prepareTaskResumeStartInput", () => {
	it("pins the config sessionId to the task and reads its persisted transcript", async () => {
		const { deps, tempHost } = makeDeps()

		const result = await prepareTaskResumeStartInput(deps, "task-1")

		expect(result.config.sessionId).toBe("task-1")
		expect(result.initialMessages).toEqual([{ role: "user", content: "sdk" }])
		expect(deps.taskHistory.getLegacyResumeInitialMessages).not.toHaveBeenCalled()
		// The transient reader host is always disposed.
		expect(tempHost.dispose).toHaveBeenCalledWith("readMessages")
	})

	it("converts a legacy task's transcript through the legacy resume path", async () => {
		const { deps } = makeDeps()
		deps.taskHistory.isLegacyTask.mockResolvedValueOnce(true)
		deps.taskHistory.getLegacyResumeInitialMessages.mockResolvedValueOnce([{ role: "user", content: "legacy" }])

		const result = await prepareTaskResumeStartInput(deps, "legacy-task")

		expect(deps.taskHistory.getLegacyResumeInitialMessages).toHaveBeenCalledWith("legacy-task", [
			{ role: "user", content: "sdk" },
		])
		expect(result.initialMessages).toEqual([{ role: "user", content: "legacy" }])
	})

	it("disposes the reader host even when reading messages throws", async () => {
		const { deps, tempHost } = makeDeps()
		deps.loadInitialMessages.mockRejectedValueOnce(new Error("read failed"))

		await expect(prepareTaskResumeStartInput(deps, "task-1")).rejects.toThrow("read failed")
		expect(tempHost.dispose).toHaveBeenCalledWith("readMessages")
	})
})
