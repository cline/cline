import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { vscode } from "@/utils/vscode"
import { getAsVar, VSC_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { useClickAway } from "react-use"
import HeroTooltip from "@/components/common/HeroTooltip"

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications"
	label: string
	shortName: string
	description: string
	icon: string
	subAction?: ActionMetadata
}

const ACTION_METADATA: ActionMetadata[] = [
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
		},
	},
	{
		id: "executeSafeCommands",
		label: "Execute safe commands",
		shortName: "Safe Commands",
		description:
			"Allows Cline to execute of safe terminal commands. If the model determines a command is potentially destructive, it will still require approval.",
		icon: "codicon-terminal",
		subAction: {
			id: "executeAllCommands",
			label: "Execute all commands",
			shortName: "All Commands",
			description: "Allows Cline to execute all terminal commands. Use at your own risk.",
			icon: "codicon-terminal-bash",
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

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	// Favorites are now derived from autoApprovalSettings
	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])
	const menuRef = useRef<HTMLDivElement>(null)

	const toggleFavorite = useCallback(
		(actionId: string) => {
			const currentSettings = autoApprovalSettings
			const currentFavorites = currentSettings.favorites || []
			let newFavorites: string[]

			if (currentFavorites.includes(actionId)) {
				newFavorites = currentFavorites.filter((id) => id !== actionId)
			} else {
				newFavorites = [...currentFavorites, actionId]
			}

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					favorites: newFavorites,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateAction = useCallback(
		(action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

			if (actionId === "enableNotifications" || subActionId === "enableNotifications") {
				return
			}

			let newActions = {
				...autoApprovalSettings.actions,
				[actionId]: value,
			}

			if (value === false && subActionId) {
				newActions[subActionId] = false
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

	const updateMaxRequests = useCallback(
		(maxRequests: number) => {
			const currentSettings = autoApprovalSettings
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					maxRequests,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateNotifications = useCallback(
		(action: ActionMetadata, checked: boolean) => {
			if (action.id === "enableNotifications") {
				const currentSettings = autoApprovalSettings
				vscode.postMessage({
					type: "autoApprovalSettings",
					autoApprovalSettings: {
						...currentSettings,
						version: (currentSettings.version ?? 1) + 1,
						enableNotifications: checked,
					},
				})
			}
		},
		[autoApprovalSettings],
	)

	// Handle clicks outside the menu to close it
	useClickAway(menuRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
		}
	})

	// Render a favorited item with a checkbox
	const renderFavoritedItem = (favId: string) => {
		// Common styles for all favorited items
		const containerStyle = {
			display: "flex",
			alignItems: "center",
			borderRadius: "4px",
		}

		// Regular action item
		const action = ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === favId)
		if (!action) return null

		const isActive =
			action.id === "enableNotifications"
				? autoApprovalSettings.enableNotifications
				: autoApprovalSettings.actions[action.id]
		const isFavorited = favorites.includes(action.id)

		return <AutoApproveMenuItem action={action} isChecked={isChecked} onToggle={updateAction} condensed={true} />
	}

	const isChecked = (action: ActionMetadata): boolean => {
		if (action.id === "enableNotifications") {
			return autoApprovalSettings.enableNotifications
		}
		return autoApprovalSettings.actions[action.id] ?? false
	}

	const isFavorited = (action: ActionMetadata): boolean => {
		return favorites.includes(action.id)
	}

	return (
		<div
			ref={menuRef}
			style={{
				padding: "0 15px",
				userSelect: "none",
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				overflowY: "auto",
				borderRadius: "10px 10px 0 0",
				backgroundColor: isExpanded ? CODE_BLOCK_BG_COLOR : "transparent",
				...style,
			}}>
			{/* Collapsed view with favorited items */}
			{!isExpanded && (
				<div onClick={() => setIsExpanded(true)} style={{ cursor: "pointer", paddingTop: "10px" }}>
					{favorites.length > 0 ? (
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "8px",
								alignItems: "center",
							}}>
							{favorites.map((favId) => renderFavoritedItem(favId))}
							<span
								className="codicon codicon-chevron-right"
								style={{
									marginLeft: "auto",
									color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
								}}
							/>
						</div>
					) : (
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								cursor: "pointer",
							}}
							onClick={() => setIsExpanded(true)}>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<HeroTooltip
									content="Auto-approve allows Cline to perform the following actions without asking for permission. Please use with caution and only enable if you understand the risks."
									placement="top">
									<span style={{ color: getAsVar(VSC_FOREGROUND), left: "0" }}>Auto-approve</span>
								</HeroTooltip>
							</div>
							<span className="codicon codicon-chevron-right" />
						</div>
					)}
				</div>
			)}

			{/* Expanded view */}
			<div
				style={{
					maxHeight: isExpanded ? "1000px" : "0px", // Large enough to fit content
					opacity: isExpanded ? 1 : 0,
					overflow: "hidden",
					transition: "max-height 0.3s ease-in-out, opacity 0.3s ease-in-out", // Removed padding to transition
				}}>
				{isExpanded && ( // Re-added conditional rendering for content
					<>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: "8px 0",
								cursor: "pointer",
								position: "relative", // Added for positioning context
							}}
							onClick={() => setIsExpanded(false)}>
							<HeroTooltip
								content="Auto-approve allows Cline to perform the following actions without asking for permission. Please use with caution and only enable if you understand the risks."
								placement="top">
								<span style={{ color: getAsVar(VSC_FOREGROUND) }}>Auto-approve</span>
							</HeroTooltip>
							<span className="codicon codicon-chevron-down" />
						</div>

						<div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "8px 0" }}>
							{[
								...ACTION_METADATA.map((action) => {
									return (
										<AutoApproveMenuItem
											key={action.id}
											action={action}
											isChecked={isChecked}
											isFavorited={isFavorited}
											onToggle={updateAction}
											onToggleFavorite={toggleFavorite}
										/>
									)
								}),
								<AutoApproveMenuItem
									key="enableNotifications"
									action={{
										id: "enableNotifications",
										label: "Enable notifications",
										shortName: "Notifications",
										description:
											"Receive system notifications when Cline requires approval to proceed or when a task is completed.",
										icon: "codicon-bell",
									}}
									isChecked={isChecked}
									onToggle={updateNotifications}
								/>,
							]}
						</div>
						<div
							style={{
								height: "0.5px",
								background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
								margin: "10px 0",
								opacity: 0.2,
							}}
						/>
						<HeroTooltip
							content="Cline will automatically make this many API requests before asking for approval to proceed with the task."
							placement="top">
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
									width: "100%",
									paddingBottom: "10px",
								}}>
								<span className="codicon codicon-settings" style={{ color: "#CCCCCC", fontSize: "14px" }} />
								<span style={{ color: "#CCCCCC", fontSize: "12px", fontWeight: 500 }}>Max Requests:</span>
								<VSCodeTextField
									style={{ flex: "1", width: "100%" }}
									value={autoApprovalSettings.maxRequests.toString()}
									onInput={(e) => {
										const input = e.target as HTMLInputElement
										// Remove any non-numeric characters
										input.value = input.value.replace(/[^0-9]/g, "")
										const value = parseInt(input.value)
										if (!isNaN(value) && value > 0) {
											updateMaxRequests(value)
										}
									}}
									onKeyDown={(e) => {
										// Prevent non-numeric keys (except for backspace, delete, arrows)
										if (
											!/^\d$/.test(e.key) &&
											!["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(e.key)
										) {
											e.preventDefault()
										}
									}}
								/>
							</div>
						</HeroTooltip>
					</>
				)}
			</div>
		</div>
	)
}

export default AutoApproveMenu
