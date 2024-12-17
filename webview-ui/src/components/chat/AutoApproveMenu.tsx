import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { AutoApprovalSettings } from "../../../../src/shared/AutoApprovalSettings"
import { vscode } from "../../utils/vscode"

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

const ACTION_METADATA: {
	id: keyof AutoApprovalSettings["actions"]
	label: string
	shortName: string
	description: string
}[] = [
	{
		id: "readFiles",
		label: "Read files and directories",
		shortName: "Read",
		description: "Allows access to read any file on your computer.",
	},
	{
		id: "editFiles",
		label: "Edit files",
		shortName: "Edit",
		description: "Allows modification of any files on your computer.",
	},
	{
		id: "executeCommands",
		label: "Execute safe commands",
		shortName: "Commands",
		description:
			"Allows execution of safe terminal commands. If the model determines a command is potentially destructive, it will still require approval.",
	},
	{
		id: "useBrowser",
		label: "Use the browser",
		shortName: "Browser",
		description: "Allows ability to launch and interact with any website in a headless browser.",
	},
	{
		id: "useMcp",
		label: "Use MCP servers",
		shortName: "MCP",
		description: "Allows use of configured MCP servers which may modify filesystem or interact with APIs.",
	},
]

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)

	// Careful not to use partials to mutate since spread operator only does shallow copy

	const updateEnabled = useCallback(
		(enabled: boolean) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					enabled,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateAction = useCallback(
		(actionId: keyof AutoApprovalSettings["actions"], value: boolean) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					actions: {
						...autoApprovalSettings.actions,
						[actionId]: value,
					},
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateMaxRequests = useCallback(
		(maxRequests: number) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					maxRequests,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateNotifications = useCallback(
		(enableNotifications: boolean) => {
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					enableNotifications,
				},
			})
		},
		[autoApprovalSettings],
	)

	const enabledActions = ACTION_METADATA.filter((action) => autoApprovalSettings.actions[action.id])
	const enabledActionsList = enabledActions.map((action) => action.shortName).join(", ")

	return (
		<div
			style={{
				padding: "0 15px",
				userSelect: "none",
				borderTop: isExpanded
					? `0.5px solid color-mix(in srgb, var(--vscode-titleBar-inactiveForeground) 20%, transparent)`
					: "none",
				overflowY: "auto",
				...style,
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					padding: isExpanded ? "8px 0" : "8px 0 0 0",
					cursor: "pointer",
				}}
				onClick={() => setIsExpanded((prev) => !prev)}>
				<VSCodeCheckbox
					checked={autoApprovalSettings.enabled}
					onChange={(e) => {
						const checked = (e.target as HTMLInputElement).checked
						updateEnabled(checked)
					}}
					onClick={(e) => e.stopPropagation()}
				/>
				<CollapsibleSection>
					<span style={{ color: "var(--vscode-foreground)", whiteSpace: "nowrap" }}>Auto-approve:</span>
					<span
						style={{
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}>
						{enabledActions.length === 0 ? "None" : enabledActionsList}
					</span>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
						style={{
							flexShrink: 0,
							marginLeft: isExpanded ? "2px" : "-2px",
						}}
					/>
				</CollapsibleSection>
			</div>
			{isExpanded && (
				<div style={{ padding: "0" }}>
					<div
						style={{
							marginBottom: "10px",
							color: "var(--vscode-descriptionForeground)",
							fontSize: "12px",
						}}>
						Auto-approve allows Cline to perform the following actions without asking for permission. This
						is potentially dangerous and could lead to unwanted system modifications. Please use with
						caution and only enable if you understand the risks.
					</div>
					{ACTION_METADATA.map((action) => (
						<div key={action.id} style={{ margin: "6px 0" }}>
							<VSCodeCheckbox
								checked={autoApprovalSettings.actions[action.id]}
								onChange={(e) => {
									const checked = (e.target as HTMLInputElement).checked
									updateAction(action.id, checked)
								}}>
								{action.label}
							</VSCodeCheckbox>
							<div
								style={{
									marginLeft: "28px",
									color: "var(--vscode-descriptionForeground)",
									fontSize: "12px",
								}}>
								{action.description}
							</div>
						</div>
					))}
					<div
						style={{
							height: "0.5px",
							background: "var(--vscode-titleBar-inactiveForeground)",
							margin: "15px 0",
							opacity: 0.2,
						}}
					/>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							marginTop: "10px",
							marginBottom: "8px",
							color: "var(--vscode-foreground)",
						}}>
						<span style={{ flexShrink: 1, minWidth: 0 }}>Max Requests:</span>
						<VSCodeTextField
							value={autoApprovalSettings.maxRequests.toString()}
							onInput={(e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								if (!isNaN(value) && value > 0) {
									updateMaxRequests(value)
								}
							}}
							style={{ flex: 1 }}
						/>
					</div>
					<div
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontSize: "12px",
							marginBottom: "10px",
						}}>
						Cline will make this many API requests before asking for approval to proceed with the task.
					</div>
					<div style={{ margin: "6px 0" }}>
						<VSCodeCheckbox
							checked={autoApprovalSettings.enableNotifications}
							onChange={(e) => {
								const checked = (e.target as HTMLInputElement).checked
								updateNotifications(checked)
							}}>
							Enable Notifications
						</VSCodeCheckbox>
						<div
							style={{
								marginLeft: "28px",
								color: "var(--vscode-descriptionForeground)",
								fontSize: "12px",
							}}>
							Receive system notifications when Cline requires approval to proceed or when a task is
							completed.
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

const CollapsibleSection = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	color: var(--vscode-descriptionForeground);
	flex: 1;
	min-width: 0;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export default AutoApproveMenu
