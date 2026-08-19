import assert from "node:assert/strict"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { describe, it, vi } from "vitest"
import type { Controller } from ".."
import { updateAutoApprovalSettings } from "./updateAutoApprovalSettings"

function makeController(currentSettings = DEFAULT_AUTO_APPROVAL_SETTINGS, taskId?: string) {
	const controller = {
		task: taskId ? { taskId } : undefined,
		getStateToPostToWebview: vi.fn(async () => ({
			autoApprovalSettings: currentSettings,
		})),
		postStateToWebview: vi.fn(async () => undefined),
		stateManager: {
			setGlobalState: vi.fn(),
			setTaskSettings: vi.fn(),
		},
	}

	return controller as unknown as Controller & {
		getStateToPostToWebview: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		stateManager: {
			setGlobalState: ReturnType<typeof vi.fn>
			setTaskSettings: ReturnType<typeof vi.fn>
		}
	}
}

describe("updateAutoApprovalSettings", () => {
	it("updates the active task override when auto-approval settings change", async () => {
		const currentSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			version: 1,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				editFiles: false,
			},
		}
		const controller = makeController(currentSettings, "task-1")

		await updateAutoApprovalSettings(
			controller,
			AutoApprovalSettingsRequest.create({
				version: 2,
				actions: {
					editFiles: true,
				},
			}),
		)

		const expectedSettings = {
			...currentSettings,
			version: 2,
			actions: {
				...currentSettings.actions,
				editFiles: true,
			},
		}

		assert.deepEqual(controller.stateManager.setGlobalState.mock.calls, [["autoApprovalSettings", expectedSettings]])
		assert.deepEqual(controller.stateManager.setTaskSettings.mock.calls, [
			["task-1", "autoApprovalSettings", expectedSettings],
		])
		assert.equal(controller.postStateToWebview.mock.calls.length, 1)
	})

	it("does not create a task override when no task is active", async () => {
		const controller = makeController(DEFAULT_AUTO_APPROVAL_SETTINGS)

		await updateAutoApprovalSettings(
			controller,
			AutoApprovalSettingsRequest.create({
				version: DEFAULT_AUTO_APPROVAL_SETTINGS.version + 1,
				actions: {
					readFiles: false,
				},
			}),
		)

		assert.equal(controller.stateManager.setGlobalState.mock.calls.length, 1)
		assert.equal(controller.stateManager.setTaskSettings.mock.calls.length, 0)
		assert.equal(controller.postStateToWebview.mock.calls.length, 1)
	})

	it("ignores stale auto-approval settings versions", async () => {
		const controller = makeController(
			{
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				version: 3,
			},
			"task-1",
		)

		await updateAutoApprovalSettings(
			controller,
			AutoApprovalSettingsRequest.create({
				version: 3,
				actions: {
					readFiles: false,
				},
			}),
		)

		assert.equal(controller.stateManager.setGlobalState.mock.calls.length, 0)
		assert.equal(controller.stateManager.setTaskSettings.mock.calls.length, 0)
		assert.equal(controller.postStateToWebview.mock.calls.length, 0)
	})
})
