import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { useCallback } from "react"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { ActionMetadata } from "@/components/chat/auto-approve-menu/types"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

export function useAutoApproveActions() {
	const { autoApprovalSettings, yoloModeToggled } = useExtensionState()

	// Check if action is enabled
	const isChecked = useCallback(
		(action: ActionMetadata): boolean => {
			switch (action.id) {
				case "enableNotifications":
					return autoApprovalSettings.enableNotifications
				case "yoloModeToggled":
					return yoloModeToggled ?? false
				default:
					return autoApprovalSettings.actions[action.id] ?? false
			}
		},
		[autoApprovalSettings, yoloModeToggled],
	)

	// Update action state
	const updateAction = useCallback(
		async (action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

			if (actionId === "yoloModeToggled") {
				// Update YOLO mode via settings handler
				updateSetting("yoloModeToggled", value)
				return
			}

			if (actionId === "enableNotifications" || subActionId === "enableNotifications") {
				await updateNotifications(action, value)
				return
			}

			const newActions = {
				...autoApprovalSettings.actions,
				[actionId]: value,
			}

			if (value === false && subActionId) {
				// @ts-expect-error: subActionId is guaranteed to be a valid action key here
				newActions[subActionId] = false
			}

			if (value === true && action.parentActionId) {
				newActions[action.parentActionId as keyof AutoApprovalSettings["actions"]] = true
			}

			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				actions: newActions,
			})
		},
		[autoApprovalSettings],
	)

	// Update notifications setting
	const updateNotifications = useCallback(
		async (action: ActionMetadata, checked: boolean) => {
			if (action.id === "enableNotifications") {
				await updateAutoApproveSettings({
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					enableNotifications: checked,
				})
			}
		},
		[autoApprovalSettings],
	)

	return {
		isChecked,
		updateAction,
		updateNotifications,
	}
}
