import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { useCallback } from "react"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { ActionMetadata } from "@/components/chat/auto-approve-menu/types"
import { useExtensionState } from "@/context/ExtensionStateContext"

export function useAutoApproveActions() {
	const { autoApprovalSettings } = useExtensionState()

	// Check if action is enabled
	const isChecked = useCallback(
		(action: ActionMetadata): boolean => {
			switch (action.id) {
				case "enableAll":
					return Object.values(autoApprovalSettings.actions).every(Boolean)
				case "enableNotifications":
					return autoApprovalSettings.enableNotifications
				case "enableAutoApprove":
					return autoApprovalSettings.enabled
				default:
					return autoApprovalSettings.actions[action.id] ?? false
			}
		},
		[autoApprovalSettings],
	)

	// Check if action is favorited
	const isFavorited = useCallback(
		(action: ActionMetadata): boolean => {
			const favorites = autoApprovalSettings.favorites || []
			return favorites.includes(action.id)
		},
		[autoApprovalSettings.favorites],
	)

	// Toggle favorite status
	const toggleFavorite = useCallback(
		async (actionId: string) => {
			const currentFavorites = autoApprovalSettings.favorites || []
			let newFavorites: string[]

			if (currentFavorites.includes(actionId)) {
				newFavorites = currentFavorites.filter((id) => id !== actionId)
			} else {
				newFavorites = [...currentFavorites, actionId]
			}

			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				favorites: newFavorites,
			})
		},
		[autoApprovalSettings],
	)

	// Update action state
	const updateAction = useCallback(
		async (action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

			if (actionId === "enableAutoApprove") {
				await updateAutoApproveEnabled(value)
				return
			}

			if (actionId === "enableAll" || subActionId === "enableAll") {
				await toggleAll(action, value)
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
				// @ts-expect-error: TODO: See how we can fix this
				newActions[subActionId] = false
			}

			if (value === true && action.parentActionId) {
				newActions[action.parentActionId as keyof AutoApprovalSettings["actions"]] = true
			}

			// Check if this will result in any enabled actions
			const willHaveEnabledActions = Object.values(newActions).some(Boolean)

			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				actions: newActions,
				enabled: willHaveEnabledActions,
			})
		},
		[autoApprovalSettings],
	)

	// Update max requests
	const updateMaxRequests = useCallback(
		async (maxRequests: number) => {
			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				maxRequests,
			})
		},
		[autoApprovalSettings],
	)

	// Update auto-approve enabled state
	const updateAutoApproveEnabled = useCallback(
		async (checked: boolean) => {
			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				enabled: checked,
			})
		},
		[autoApprovalSettings],
	)

	// Toggle all actions
	const toggleAll = useCallback(
		async (_action: ActionMetadata, checked: boolean) => {
			const actions = { ...autoApprovalSettings.actions }

			for (const action of Object.keys(actions)) {
				actions[action as keyof AutoApprovalSettings["actions"]] = checked
			}

			await updateAutoApproveSettings({
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
				actions,
				enabled: checked,
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
		isFavorited,
		toggleFavorite,
		updateAction,
		updateMaxRequests,
		updateAutoApproveEnabled,
		toggleAll,
		updateNotifications,
	}
}
