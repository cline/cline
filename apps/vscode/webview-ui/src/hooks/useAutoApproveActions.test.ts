import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { ActionMetadata } from "@/components/chat/auto-approve-menu/types"
import { useAutoApproveActions } from "./useAutoApproveActions"

const mocks = vi.hoisted(() => ({
	autoApprovalSettings: undefined as typeof DEFAULT_AUTO_APPROVAL_SETTINGS | undefined,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: mocks.autoApprovalSettings,
	}),
}))

vi.mock("@/components/chat/auto-approve-menu/AutoApproveSettingsAPI", () => ({
	updateAutoApproveSettings: vi.fn(),
}))

const executeCommandsAction: ActionMetadata = {
	id: "executeSafeCommands",
	label: "Execute commands",
	shortName: "Commands",
	icon: "codicon-terminal",
}

describe("useAutoApproveActions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(updateAutoApproveSettings).mockResolvedValue(undefined)
		mocks.autoApprovalSettings = DEFAULT_AUTO_APPROVAL_SETTINGS
	})

	it("treats legacy executeAllCommands as enabling the visible commands toggle", () => {
		mocks.autoApprovalSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		const { result } = renderHook(() => useAutoApproveActions())

		expect(result.current.isChecked(executeCommandsAction)).toBe(true)
	})

	it("clears legacy executeAllCommands when the visible commands toggle is turned off", async () => {
		mocks.autoApprovalSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: true,
				executeAllCommands: true,
			},
		}

		const { result } = renderHook(() => useAutoApproveActions())

		await act(async () => {
			await result.current.updateAction(executeCommandsAction, false)
		})

		expect(updateAutoApproveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: expect.objectContaining({
					executeSafeCommands: false,
					executeAllCommands: false,
				}),
			}),
		)
	})
})
