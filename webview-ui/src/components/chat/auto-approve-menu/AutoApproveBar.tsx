// webview-ui/src/components/chat/auto-approve-menu/AutoApproveBar.tsx
import { useCallback, useRef, useState, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { getAsVar, VSC_FOREGROUND_MUTED, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { ActionMetadata } from "./types"
import AutoApproveModal from "./AutoApproveModal"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

// Action metadata definitions moved to a shared location to be used by both Bar and Modal
export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "enableAll",
		label: "Enable all",
		shortName: "All",
		description: "Enable all actions.",
		icon: "codicon-checklist",
	},
	{
		id: "readFiles",
		label: "Read project files",
		shortName: "Read",
		description: "Allows Cline to read files within your workspace.",
		icon: "codicon-search",
		subAction: {
			id: "readFilesExternally",
			label: "Read all files",
			shortName: "Read (all)",
			description: "Allows Cline to read any file on your computer.",
			icon: "codicon-folder-opened",
			parentActionId: "readFiles",
		},
	},
	{
		id: "editFiles",
		label: "Edit project files",
		shortName: "Edit",
		description: "Allows Cline to modify files within your workspace.",
		icon: "codicon-edit",
		subAction: {
			id: "editFilesExternally",
			label: "Edit all files",
			shortName: "Edit (all)",
			description: "Allows Cline to modify any file on your computer.",
			icon: "codicon-files",
			parentActionId: "editFiles",
		},
	},
	{
		id: "executeSafeCommands",
		label: "Execute safe commands",
		shortName: "Safe Commands",
		description:
			"Allows Cline to execute safe terminal commands. If the model determines a command is potentially destructive, it will still require approval.",
		icon: "codicon-terminal",
		subAction: {
			id: "executeAllCommands",
			label: "Execute all commands",
			shortName: "All Commands",
			description: "Allows Cline to execute all terminal commands. Use at your own risk.",
			icon: "codicon-terminal-bash",
			parentActionId: "executeSafeCommands",
		},
	},
	{
		id: "useBrowser",
		label: "Use the browser",
		shortName: "Browser",
		description: "Allows Cline to launch and interact with any website in a browser.",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "Use MCP servers",
		shortName: "MCP",
		description: "Allows Cline to use configured MCP servers which may modify filesystem or interact with APIs.",
		icon: "codicon-server",
	},
]

// Notifications setting moved here to be accessible by both components
export const NOTIFICATIONS_SETTING: ActionMetadata = {
	id: "enableNotifications",
	label: "Enable notifications",
	shortName: "Notifications",
	description: "Receive system notifications when Cline requires approval to proceed or when a task is completed.",
	icon: "codicon-bell",
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	// Favorites are derived from autoApprovalSettings
	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])

	// Render a favorited item with a checkbox
	const renderFavoritedItem = (favId: string) => {
		const actions = [...ACTION_METADATA.flatMap((a) => [a, a.subAction]), NOTIFICATIONS_SETTING]
		const action = actions.find((a) => a?.id === favId)
		if (!action) return null

		return (
			<AutoApproveMenuItem
				action={action}
				isChecked={isChecked}
				isFavorited={isFavorited}
				onToggle={updateAction}
				condensed={true}
			/>
		)
	}

	// Quick access items for the collapsed bar
	const getQuickAccessItems = () => {
		const notificationsEnabled = autoApprovalSettings.enableNotifications
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		let minusFavorites = enabledActions.filter((action) => !favorites.includes(action?.id ?? "") && action?.shortName)

		if (notificationsEnabled) {
			minusFavorites.push(NOTIFICATIONS_SETTING)
		}

		return [
			...favorites.map((favId) => renderFavoritedItem(favId)),
			minusFavorites.length > 0 ? (
				<span className="text-[color:var(--vscode-foreground-muted)] pl-[10px] opacity-60" key="separator">
					✓
				</span>
			) : null,
			...minusFavorites.map((action, index) => (
				<span className="text-[color:var(--vscode-foreground-muted)] opacity-60" key={action?.id}>
					{action?.shortName}
					{index < minusFavorites.length - 1 && ","}
				</span>
			)),
		]
	}

	const isChecked = (action: ActionMetadata): boolean => {
		if (action.id === "enableNotifications") {
			return autoApprovalSettings.enableNotifications
		}
		if (action.id === "enableAll") {
			return Object.values(autoApprovalSettings.actions).every(Boolean)
		}
		return autoApprovalSettings.actions[action.id] ?? false
	}

	const isFavorited = (action: ActionMetadata): boolean => {
		return favorites.includes(action.id)
	}

	const updateAction = useCallback(() => {
		// This is just a placeholder since we need to pass it to AutoApproveMenuItem
		// The actual implementation is in the modal component
	}, [])

	return (
		<div
			className="px-[4px_10px] mx-[5px] select-none rounded-[10px_10px_0_0]"
			style={{
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				overflowY: "auto",
				backgroundColor: isModalVisible ? CODE_BLOCK_BG_COLOR : "transparent",
				...style,
			}}>
			<div
				ref={buttonRef}
				className="cursor-pointer pt-[6px] pr-[2px] flex items-center justify-between gap-[8px]"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}>
				<div
					className="flex flex-nowrap items-center overflow-x-auto gap-[4px] whitespace-nowrap"
					style={{
						msOverflowStyle: "none",
						scrollbarWidth: "none",
						WebkitOverflowScrolling: "touch",
					}}>
					<span>Auto-approve:</span>
					{getQuickAccessItems()}
				</div>
				<span className="codicon codicon-chevron-right" />
			</div>

			<AutoApproveModal
				isVisible={isModalVisible}
				setIsVisible={setIsModalVisible}
				buttonRef={buttonRef}
				ACTION_METADATA={ACTION_METADATA}
				NOTIFICATIONS_SETTING={NOTIFICATIONS_SETTING}
			/>
		</div>
	)
}

export default AutoApproveBar
