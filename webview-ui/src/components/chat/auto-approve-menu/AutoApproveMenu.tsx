import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { vscode } from "@/utils/vscode"
import { getAsVar, VSC_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND, VSC_FOREGROUND_MUTED } from "@/utils/vscStyles"
import { useClickAway } from "react-use"
import HeroTooltip from "@/components/common/HeroTooltip"

const breakpoint = 500

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications" | "enableAll"
	label: string
	shortName: string
	description: string
	icon: string
	subAction?: ActionMetadata
	sub?: boolean
	parentActionId?: string
}

const ACTION_METADATA: ActionMetadata[] = [
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

const NOTIFICATIONS_SETTING: ActionMetadata = {
	id: "enableNotifications",
	label: "Enable notifications",
	shortName: "Notifications",
	description: "Receive system notifications when Cline requires approval to proceed or when a task is completed.",
	icon: "codicon-bell",
}

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	const [containerWidth, setContainerWidth] = useState(0)
	// Favorites are now derived from autoApprovalSettings
	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])
	const menuRef = useRef<HTMLDivElement>(null)
	const itemsContainerRef = useRef<HTMLDivElement>(null)

	// Track container width for responsive layout
	useEffect(() => {
		if (!isExpanded) return

		const updateWidth = () => {
			if (itemsContainerRef.current) {
				setContainerWidth(itemsContainerRef.current.offsetWidth)
			}
		}

		// Initial measurement
		updateWidth()

		// Set up resize observer
		const resizeObserver = new ResizeObserver(updateWidth)
		if (itemsContainerRef.current) {
			resizeObserver.observe(itemsContainerRef.current)
		}

		// Clean up
		return () => {
			resizeObserver.disconnect()
		}
	}, [isExpanded])

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

	const updateAction = useCallback(
		(action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

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
				},
			})
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

	// Render a favorited item with a checkbox
	const getQuickAccessItems = () => {
		const notificationsEnabled = autoApprovalSettings.enableNotifications
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof AutoApprovalSettings["actions"]],
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
				<span style={{ color: getAsVar(VSC_FOREGROUND_MUTED), paddingLeft: "10px", opacity: 0.6 }} key="separator">
					✓
				</span>
			) : null,
			...minusFavorites.map((action, index) => (
				<span
					style={{
						color: getAsVar(VSC_FOREGROUND_MUTED),
						opacity: 0.6,
					}}
					key={action?.id}>
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

	return (
		<div
			ref={menuRef}
			style={{
				padding: "0 10px",
				margin: "0 5px",
				userSelect: "none",
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				overflowY: "auto",
				borderRadius: "10px 10px 0 0",
				backgroundColor: isExpanded ? CODE_BLOCK_BG_COLOR : "transparent",
				...style,
			}}>
			{/* Collapsed view with favorited items */}
			{!isExpanded && (
				<div
					onClick={() => setIsExpanded(true)}
					style={{
						cursor: "pointer",
						paddingTop: "6px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "8px",
					}}>
					<div
						style={{
							display: "flex",
							flexWrap: "nowrap",
							alignItems: "center",
							overflowX: "auto",
							msOverflowStyle: "none",
							scrollbarWidth: "none",
							WebkitOverflowScrolling: "touch",
							gap: "4px",
							whiteSpace: "nowrap", // Prevent text wrapping
						}}>
						{getQuickAccessItems()}
					</div>
					<span className="codicon codicon-chevron-right" />
				</div>
			)}

			{/* Expanded view */}
			<div
				style={{
					maxHeight: isExpanded ? "1000px" : favorites.length > 0 ? "40px" : "22px", // Large enough to fit content
					opacity: isExpanded ? 1 : 0,
					overflow: "hidden",
					transition: "max-height 0.3s ease-in-out, opacity 0.3s ease-in-out",
					display: "flex",
					flexDirection: "column",
					gap: "4px",
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
							<span className="codicon codicon-chevron-down" style={{ paddingRight: "4px" }} />
						</div>

						<div
							ref={itemsContainerRef}
							style={{
								columnCount: containerWidth > breakpoint ? 2 : 1,
								columnGap: "4px",
								margin: "4px 0 8px 0",
								position: "relative", // For absolute positioning of the separator
							}}>
							{/* Vertical separator line - only visible in two-column mode */}
							{containerWidth > breakpoint && (
								<div
									style={{
										position: "absolute",
										left: "50%",
										top: "0",
										bottom: "0",
										width: "0.5px",
										background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
										opacity: 0.2,
										transform: "translateX(-50%)", // Center the line
									}}
								/>
							)}

							{/* All items in a single list - CSS Grid will handle the column distribution */}
							{ACTION_METADATA.map((action) => (
								<AutoApproveMenuItem
									key={action.id}
									action={action}
									isChecked={isChecked}
									isFavorited={isFavorited}
									onToggle={updateAction}
									onToggleFavorite={toggleFavorite}
								/>
							))}
						</div>
						<div
							style={{
								height: "0.5px",
								background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
								margin: "8px 0",
								opacity: 0.2,
							}}
						/>
						<AutoApproveMenuItem
							key={NOTIFICATIONS_SETTING.id}
							action={NOTIFICATIONS_SETTING}
							isChecked={isChecked}
							isFavorited={isFavorited}
							onToggle={updateAction}
							onToggleFavorite={toggleFavorite}
						/>
						<HeroTooltip
							content="Cline will automatically make this many API requests before asking for approval to proceed with the task."
							placement="top">
							<div
								style={{
									margin: "2px 10px 10px 5px",
									display: "flex",
									alignItems: "center",
									gap: "8px",
									width: "100%",
								}}>
								<span className="codicon codicon-settings" style={{ color: "#CCCCCC", fontSize: "14px" }} />
								<span style={{ color: "#CCCCCC", fontSize: "12px", fontWeight: 500 }}>Max Requests:</span>
								<VSCodeTextField
									style={{ flex: "1", width: "100%", paddingRight: "35px" }}
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
				{isExpanded && (
					<span
						className="codicon codicon-chevron-up"
						style={{ paddingBottom: "4px", marginLeft: "auto", marginTop: "-20px", cursor: "pointer" }}
						onClick={() => setIsExpanded(false)}
					/>
				)}
			</div>
		</div>
	)
}

export default AutoApproveMenu
