import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import styled from "styled-components"

interface AutoApproveAction {
	id: string
	label: string
	enabled: boolean
	description: string
}

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

const DEFAULT_MAX_REQUESTS = 50

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [actions, setActions] = useState<AutoApproveAction[]>([
		{
			id: "readFiles",
			label: "Read files and directories",
			enabled: false,
			description: "Allows access to read any file on your computer.",
		},
		{
			id: "editFiles",
			label: "Edit files",
			enabled: false,
			description: "Allows modification of any files on your computer.",
		},
		{
			id: "executeCommands",
			label: "Execute safe commands",
			enabled: false,
			description:
				"Allows automatic execution of safe terminal commands. The model will determine if a command is potentially destructive and ask for explicit approval.",
		},
		{
			id: "useBrowser",
			label: "Use the browser",
			enabled: false,
			description: "Allows ability to launch and interact with any website in a headless browser.",
		},
		{
			id: "useMcp",
			label: "Use MCP servers",
			enabled: false,
			description: "Allows use of configured MCP servers which may modify filesystem or interact with APIs.",
		},
	])
	const [maxRequests, setMaxRequests] = useState(DEFAULT_MAX_REQUESTS)
	const [enableNotifications, setEnableNotifications] = useState(false)

	const toggleExpanded = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	const toggleAction = useCallback((actionId: string) => {
		setActions((prev) =>
			prev.map((action) => (action.id === actionId ? { ...action, enabled: !action.enabled } : action)),
		)
	}, [])

	const enabledActions = actions.filter((action) => action.enabled)
	const enabledActionsList = enabledActions.map((action) => action.label).join(", ")

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
				onClick={toggleExpanded}>
				<VSCodeCheckbox
					checked={enabledActions.length > 0}
					onChange={(e) => {
						const checked = (e.target as HTMLInputElement).checked
						setActions((prev) =>
							prev.map((action) => ({
								...action,
								enabled: checked,
							})),
						)
						e.stopPropagation()
					}}
					onClick={(e) => e.stopPropagation()}
				/>
				<CollapsibleSection>
					<span style={{ color: "var(--vscode-foreground)" }}>Auto-approve:</span>
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
							// fontSize: "14px",
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
						Auto-approve allows Cline to perform actions without asking for permission. Only enable for
						actions you fully trust, and consider setting a low request limit as a safeguard.
					</div>
					{actions.map((action) => (
						<div key={action.id} style={{ margin: "6px 0" }}>
							<VSCodeCheckbox checked={action.enabled} onChange={() => toggleAction(action.id)}>
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
							value={maxRequests.toString()}
							onChange={(e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								if (!isNaN(value) && value > 0) {
									setMaxRequests(value)
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
							checked={enableNotifications}
							onChange={() => setEnableNotifications((prev) => !prev)}>
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
