import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useMemo, useRef, useState, useEffect } from "react"
// import styled from "styled-components" // No longer needed here
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

// SubOptionAnimateIn is now in AutoApproveMenuItem.tsx

const ACTION_METADATA: {
	id: keyof AutoApprovalSettings["actions"]
	label: string
	shortName: string
	description: string
}[] = [
	{
		id: "readFiles",
		label: "Read project files",
		shortName: "Read Local",
		description: "Allows Cline to read files within your workspace.",
	},
	{
		id: "readFilesExternally",
		label: "Read all files",
		shortName: "Read (all)",
		description: "Allows Cline to read any file on your computer.",
	},
	{
		id: "editFiles",
		label: "Edit project files",
		shortName: "Edit",
		description: "Allows Cline to modify files within your workspace.",
	},
	{
		id: "editFilesExternally",
		label: "Edit all files",
		shortName: "Edit (all)",
		description: "Allows Cline to modify any file on your computer.",
	},
	{
		id: "executeSafeCommands",
		label: "Execute safe commands",
		shortName: "Safe Commands",
		description:
			"Allows Cline to execute of safe terminal commands. If the model determines a command is potentially destructive, it will still require approval.",
	},
	{
		id: "executeAllCommands",
		label: "Execute all commands",
		shortName: "All Commands",
		description: "Allows Cline to execute all terminal commands. Use at your own risk.",
	},
	{
		id: "useBrowser",
		label: "Use the browser",
		shortName: "Browser",
		description: "Allows Cline to launch and interact with any website in a browser.",
	},
	{
		id: "useMcp",
		label: "Use MCP servers",
		shortName: "MCP",
		description: "Allows Cline to use configured MCP servers which may modify filesystem or interact with APIs.",
	},
]

// const FAVORITES_STORAGE_KEY = "cline-auto-approve-favorites" // No longer needed

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const extensionState = useExtensionState()
	const { autoApprovalSettings } = extensionState
	const [isExpanded, setIsExpanded] = useState(false)
	// Favorites are now derived from autoApprovalSettings
	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])
	const menuRef = useRef<HTMLDivElement>(null)

	const toggleFavorite = useCallback(
		(actionId: string) => {
			const currentSettings = extensionState.autoApprovalSettings
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
		[extensionState.autoApprovalSettings],
	)

	// Careful not to use partials to mutate since spread operator only does shallow copy
	const enabledActions = ACTION_METADATA.filter((action) => autoApprovalSettings.actions[action.id])
	const enabledActionsList = useMemo(() => {
		// When nested auto-approve options are used, display the more permissive one (file reads, edits, and commands)
		const readFilesEnabled = enabledActions.some((action) => action.id === "readFiles")
		const readFilesExternallyEnabled = enabledActions.some((action) => action.id === "readFilesExternally")

		const editFilesEnabled = enabledActions.some((action) => action.id === "editFiles")
		const editFilesExternallyEnabled = enabledActions.some((action) => action.id === "editFilesExternally") ?? false

		const safeCommandsEnabled = enabledActions.some((action) => action.id === "executeSafeCommands")
		const allCommandsEnabled = enabledActions.some((action) => action.id === "executeAllCommands") ?? false
		// Filter out the potentially nested options so we don't display them twice
		const otherActions = enabledActions
			.filter(
				(action) =>
					action.id !== "readFiles" &&
					action.id !== "readFilesExternally" &&
					action.id !== "editFiles" &&
					action.id !== "editFilesExternally" &&
					action.id !== "executeSafeCommands" &&
					action.id !== "executeAllCommands",
			)
			.map((action) => action.shortName)

		const labels = []

		// Handle read editing labels
		if (readFilesExternallyEnabled && readFilesEnabled) {
			labels.push("Read (All)")
		} else if (readFilesEnabled) {
			labels.push("Read")
		}

		// Handle file editing labels
		if (editFilesExternallyEnabled && editFilesEnabled) {
			labels.push("Edit (All)")
		} else if (editFilesEnabled) {
			labels.push("Edit")
		}

		// Handle command execution labels
		if (allCommandsEnabled && safeCommandsEnabled) {
			labels.push("All Commands")
		} else if (safeCommandsEnabled) {
			labels.push("Safe Commands")
		}

		// Add remaining actions
		return [...labels, ...otherActions].join(", ")
	}, [enabledActions])

	// This value is used to determine if the auto-approve menu should show 'Auto-approve: None'
	// Note: we should use better logic to determine the state where no auto approve actions are in effect, regardless of the state of sub-auto-approve options
	const hasEnabledActions = useMemo(() => {
		// Count actions that are truly enabled, considering parent/child relationships
		let count = 0
		ACTION_METADATA.forEach((actionMeta) => {
			if (autoApprovalSettings.actions[actionMeta.id]) {
				// If it's a child option, only count if its parent is also enabled
				if (actionMeta.id === "readFilesExternally" && !autoApprovalSettings.actions.readFiles) {
					return
				}
				if (actionMeta.id === "editFilesExternally" && !autoApprovalSettings.actions.editFiles) {
					return
				}
				if (actionMeta.id === "executeAllCommands" && !autoApprovalSettings.actions.executeSafeCommands) {
					return
				}
				count++
			}
		})
		return count > 0
	}, [autoApprovalSettings.actions])

	// Get the full extension state to ensure we have the most up-to-date settings
	// const extensionState = useExtensionState() // Already declared at the top

	const updateEnabled = useCallback(
		(enabled: boolean) => {
			const currentSettings = extensionState.autoApprovalSettings
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					enabled,
				},
			})
		},
		[extensionState.autoApprovalSettings],
	)

	const updateAction = useCallback(
		(actionId: keyof AutoApprovalSettings["actions"], value: boolean) => {
			const currentSettings = extensionState.autoApprovalSettings
			// Calculate what the new actions state will be
			const newActions = {
				...currentSettings.actions,
				[actionId]: value,
			}

			// Check if this will result in any enabled actions
			const willHaveEnabledActions = Object.values(newActions).some(Boolean)

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					actions: newActions,
					// If no actions will be enabled, ensure the main toggle is off
					enabled: willHaveEnabledActions ? currentSettings.enabled : false,
				},
			})
		},
		[extensionState.autoApprovalSettings],
	)

	const updateMaxRequests = useCallback(
		(maxRequests: number) => {
			const currentSettings = extensionState.autoApprovalSettings
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					maxRequests,
				},
			})
		},
		[extensionState.autoApprovalSettings],
	)

	const updateNotifications = useCallback(
		(enableNotifications: boolean) => {
			const currentSettings = extensionState.autoApprovalSettings
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					enableNotifications,
				},
			})
		},
		[extensionState.autoApprovalSettings],
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

		// Handle different types of favorited items
		if (favId === "maxRequests") {
			return (
				<div key={favId} style={containerStyle}>
					<span className="codicon codicon-star-full" style={{ color: "#FFCC00", fontSize: "12px" }} />
					<span style={{ fontSize: "12px" }}>Max:</span>
					<VSCodeTextField
						value={autoApprovalSettings.maxRequests.toString()}
						onInput={(e) => {
							const input = e.target as HTMLInputElement
							input.value = input.value.replace(/[^0-9]/g, "")
							const value = parseInt(input.value)
							if (!isNaN(value) && value > 0) {
								updateMaxRequests(value)
							}
						}}
						style={{ width: "40px" }}
					/>
				</div>
			)
		} else if (favId === "enableNotifications") {
			return (
				<div key={favId} style={containerStyle}>
					<VSCodeCheckbox
						checked={autoApprovalSettings.enableNotifications}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked
							updateNotifications(checked)
						}}>
						<span style={{ fontSize: "12px" }}>Notifications</span>
					</VSCodeCheckbox>
				</div>
			)
		} else {
			// Regular action item
			const action = ACTION_METADATA.find((a) => a.id === favId)
			if (!action) return null

			return (
				<div key={favId} style={containerStyle} onClick={(e) => e.stopPropagation()}>
					<VSCodeCheckbox
						checked={autoApprovalSettings.actions[action.id]}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked
							updateAction(action.id, checked)
						}}>
						<span style={{ fontSize: "12px" }}>{action.shortName}</span>
					</VSCodeCheckbox>
				</div>
			)
		}
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
							<HeroTooltip
								content="Auto-approve allows Cline to perform the following actions without asking for permission. Please use with caution and only enable if you understand the risks."
								placement="top">
								<span style={{ color: getAsVar(VSC_FOREGROUND), left: "0" }}>Auto-approve</span>
							</HeroTooltip>
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

						{ACTION_METADATA.map((action) => {
							const isSubOption =
								action.id === "executeAllCommands" ||
								action.id === "editFilesExternally" ||
								action.id === "readFilesExternally"

							const parentActionId =
								action.id === "executeAllCommands"
									? "executeSafeCommands"
									: action.id === "editFilesExternally"
										? "editFiles"
										: action.id === "readFilesExternally"
											? "readFiles"
											: undefined

							return (
								<AutoApproveMenuItem
									key={action.id}
									action={action}
									isChecked={Boolean(autoApprovalSettings.actions[action.id])}
									isFavorited={favorites.includes(action.id)}
									isSubOption={isSubOption}
									isSubOptionExpanded={Boolean(
										parentActionId
											? autoApprovalSettings.actions[parentActionId]
											: autoApprovalSettings.actions[action.id],
									)}
									onToggle={updateAction}
									onToggleFavorite={toggleFavorite}
									onToggleSubOption={(currentActionId) =>
										updateAction(currentActionId, !autoApprovalSettings.actions[currentActionId])
									}
								/>
							)
						})}
						<div
							style={{
								height: "0.5px",
								background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
								margin: "15px 0",
								opacity: 0.2,
							}}
						/>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								width: "100%",
							}}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
									marginTop: "10px",
									marginBottom: "8px",
									color: getAsVar(VSC_FOREGROUND),
									flex: 1,
									position: "relative", // Added for tooltip positioning
								}}>
								<HeroTooltip
									content="Cline will automatically make this many API requests before asking for approval to proceed with the task."
									placement="top">
									<span style={{ color: getAsVar(VSC_FOREGROUND) }}>Max Requests:</span>
								</HeroTooltip>
								<VSCodeTextField
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
									style={{ flex: 1, marginRight: "10px" }}
								/>
							</div>
							<span
								className={`codicon codicon-${favorites.includes("maxRequests") ? "star-full" : "star-empty"}`}
								style={{
									cursor: "pointer",
									color: favorites.includes("maxRequests") ? "#FFCC00" : getAsVar(VSC_DESCRIPTION_FOREGROUND),
									opacity: favorites.includes("maxRequests") ? 1 : 0.6,
									marginRight: "4px",
								}}
								onClick={(e) => {
									e.stopPropagation()
									toggleFavorite("maxRequests")
								}}
							/>
						</div>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								width: "100%",
								margin: "6px 0",
							}}>
							<HeroTooltip
								content="Receive system notifications when Cline requires approval to proceed or when a task is completed."
								placement="top">
								<VSCodeCheckbox
									checked={autoApprovalSettings.enableNotifications}
									onChange={(e) => {
										const checked = (e.target as HTMLInputElement).checked
										updateNotifications(checked)
									}}>
									Enable Notifications
								</VSCodeCheckbox>
							</HeroTooltip>
							<span
								className={`codicon codicon-${favorites.includes("enableNotifications") ? "star-full" : "star-empty"}`}
								style={{
									cursor: "pointer",
									color: favorites.includes("enableNotifications")
										? "#FFCC00"
										: getAsVar(VSC_DESCRIPTION_FOREGROUND),
									opacity: favorites.includes("enableNotifications") ? 1 : 0.6,
									marginRight: "4px",
								}}
								onClick={(e) => {
									e.stopPropagation()
									toggleFavorite("enableNotifications")
								}}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	)
}

// CollapsibleSection is no longer used
// const CollapsibleSection = styled.div<{ isHovered?: boolean }>`
// 	display: flex;
// 	align-items: center;
// 	gap: 4px;
// 	color: ${(props) => (props.isHovered ? getAsVar(VSC_FOREGROUND) : getAsVar(VSC_DESCRIPTION_FOREGROUND))};
// 	flex: 1;
// 	min-width: 0;
//
// 	&:hover {
// 		color: ${getAsVar(VSC_FOREGROUND)};
// 	}
// `

export default AutoApproveMenu
