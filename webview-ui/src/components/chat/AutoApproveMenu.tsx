import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"

interface AutoApproveAction {
	id: string
	label: string
	enabled: boolean
	shortName: string
	description: string
}

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const {
		alwaysAllowReadOnly,
		setAlwaysAllowReadOnly,
		alwaysAllowWrite,
		setAlwaysAllowWrite,
		alwaysAllowExecute,
		setAlwaysAllowExecute,
		alwaysAllowBrowser,
		setAlwaysAllowBrowser,
		alwaysAllowMcp,
		setAlwaysAllowMcp,
		alwaysApproveResubmit,
		setAlwaysApproveResubmit,
		autoApprovalEnabled,
		setAutoApprovalEnabled,
	} = useExtensionState()

	const actions: AutoApproveAction[] = [
		{
			id: "readFiles",
			label: "Read files and directories",
			shortName: "Read",
			enabled: alwaysAllowReadOnly ?? false,
			description: "Allows access to read any file on your computer.",
		},
		{
			id: "editFiles",
			label: "Edit files",
			shortName: "Edit",
			enabled: alwaysAllowWrite ?? false,
			description: "Allows modification of any files on your computer.",
		},
		{
			id: "executeCommands",
			label: "Execute safe commands",
			shortName: "Commands",
			enabled: alwaysAllowExecute ?? false,
			description:
				"Allows execution of approved terminal commands. You can configure this in the settings panel.",
		},
		{
			id: "useBrowser",
			label: "Use the browser",
			shortName: "Browser",
			enabled: alwaysAllowBrowser ?? false,
			description: "Allows ability to launch and interact with any website in a headless browser.",
		},
		{
			id: "useMcp",
			label: "Use MCP servers",
			shortName: "MCP",
			enabled: alwaysAllowMcp ?? false,
			description: "Allows use of configured MCP servers which may modify filesystem or interact with APIs.",
		},
		{
			id: "retryRequests",
			label: "Retry failed requests",
			shortName: "Retries",
			enabled: alwaysApproveResubmit ?? false,
			description: "Automatically retry failed API requests when the provider returns an error response.",
		},
	]

	const toggleExpanded = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	const enabledActionsList = actions
		.filter((action) => action.enabled)
		.map((action) => action.shortName)
		.join(", ")

	// Individual checkbox handlers - each one only updates its own state
	const handleReadOnlyChange = useCallback(() => setAlwaysAllowReadOnly(!(alwaysAllowReadOnly ?? false)), [alwaysAllowReadOnly, setAlwaysAllowReadOnly])
	const handleWriteChange = useCallback(() => setAlwaysAllowWrite(!(alwaysAllowWrite ?? false)), [alwaysAllowWrite, setAlwaysAllowWrite])
	const handleExecuteChange = useCallback(() => setAlwaysAllowExecute(!(alwaysAllowExecute ?? false)), [alwaysAllowExecute, setAlwaysAllowExecute])
	const handleBrowserChange = useCallback(() => setAlwaysAllowBrowser(!(alwaysAllowBrowser ?? false)), [alwaysAllowBrowser, setAlwaysAllowBrowser])
	const handleMcpChange = useCallback(() => setAlwaysAllowMcp(!(alwaysAllowMcp ?? false)), [alwaysAllowMcp, setAlwaysAllowMcp])
	const handleRetryChange = useCallback(() => setAlwaysApproveResubmit(!(alwaysApproveResubmit ?? false)), [alwaysApproveResubmit, setAlwaysApproveResubmit])

	// Map action IDs to their specific handlers
	const actionHandlers: Record<AutoApproveAction['id'], () => void> = {
		readFiles: handleReadOnlyChange,
		editFiles: handleWriteChange,
		executeCommands: handleExecuteChange,
		useBrowser: handleBrowserChange,
		useMcp: handleMcpChange,
		retryRequests: handleRetryChange,
	}

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
				<div onClick={(e) => e.stopPropagation()}>
					<VSCodeCheckbox
						checked={autoApprovalEnabled ?? false}
						onChange={() => setAutoApprovalEnabled(!(autoApprovalEnabled ?? false))}
					/>
				</div>
				<div style={{
					display: 'flex',
					alignItems: 'center',
					gap: '4px',
					flex: 1,
					minWidth: 0
				}}>
					<span style={{
						color: "var(--vscode-foreground)",
						flexShrink: 0
					}}>Auto-approve:</span>
					<span style={{
						color: "var(--vscode-descriptionForeground)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
						minWidth: 0
					}}>
						{enabledActionsList || "None"}
					</span>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
						style={{
							flexShrink: 0,
							marginLeft: isExpanded ? "2px" : "-2px",
						}}
					/>
				</div>
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
						actions you fully trust.
					</div>
					{actions.map((action) => (
						<div key={action.id} style={{ margin: "6px 0" }}>
							<div onClick={(e) => e.stopPropagation()}>
								<VSCodeCheckbox
									checked={action.enabled}
									onChange={actionHandlers[action.id]}>
									{action.label}
								</VSCodeCheckbox>
							</div>
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
				</div>
			)}
		</div>
	)
}

export default AutoApproveMenu
