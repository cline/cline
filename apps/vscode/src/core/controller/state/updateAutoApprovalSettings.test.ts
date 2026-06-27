import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { describe, expect, it, vi } from "vitest"
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

		expect(controller.stateManager.setGlobalState).toHaveBeenCalledWith("autoApprovalSettings", expectedSettings)
		expect(controller.stateManager.setTaskSettings).toHaveBeenCalledWith("task-1", "autoApprovalSettings", expectedSettings)
		expect(controller.postStateToWebview).toHaveBeenCalledOnce()
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

		expect(controller.stateManager.setGlobalState).toHaveBeenCalledOnce()
		expect(controller.stateManager.setTaskSettings).not.toHaveBeenCalled()
		expect(controller.postStateToWebview).toHaveBeenCalledOnce()
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

		expect(controller.stateManager.setGlobalState).not.toHaveBeenCalled()
		expect(controller.stateManager.setTaskSettings).not.toHaveBeenCalled()
		expect(controller.postStateToWebview).not.toHaveBeenCalled()
	})
})
