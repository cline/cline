import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { ActionMetadata } from "@/components/chat/auto-approve-menu/types"

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
		(actionId: string) => {
			const currentFavorites = autoApprovalSettings.favorites || []
			let newFavorites: string[]

			if (currentFavorites.includes(actionId)) {
				newFavorites = currentFavorites.filter((id) => id !== actionId)
			} else {
				newFavorites = [...currentFavorites, actionId]
			}

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					favorites: newFavorites,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Update action state
	const updateAction = useCallback(
		(action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

			if (actionId === "enableAutoApprove") {
				updateAutoApproveEnabled(value)
				return
			}

			if (actionId === "enableAll" || subActionId === "enableAll") {
				toggleAll(action, value)
				return
			}

			if (actionId === "enableNotifications" || subActionId === "enableNotifications") {
				updateNotifications(action, value)
				return
			}

			let newActions = {
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

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					actions: newActions,
					enabled: willHaveEnabledActions,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Update max requests
	const updateMaxRequests = useCallback(
		(maxRequests: number) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					maxRequests,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Update auto-approve enabled state
	const updateAutoApproveEnabled = useCallback(
		(checked: boolean) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					enabled: checked,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Toggle all actions
	const toggleAll = useCallback(
		(action: ActionMetadata, checked: boolean) => {
			let actions = { ...autoApprovalSettings.actions }

			for (const action of Object.keys(actions)) {
				actions[action as keyof AutoApprovalSettings["actions"]] = checked
			}

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					actions,
					enabled: checked,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Update notifications setting
	const updateNotifications = useCallback(
		(action: ActionMetadata, checked: boolean) => {
			if (action.id === "enableNotifications") {
				vscode.postMessage({
					type: "autoApprovalSettings",
					autoApprovalSettings: {
						...autoApprovalSettings,
						version: (autoApprovalSettings.version ?? 1) + 1,
						enableNotifications: checked,
					},
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
