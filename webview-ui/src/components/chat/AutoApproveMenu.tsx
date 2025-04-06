import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { useAppTranslation } from "../../i18n/TranslationContext"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"

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
		alwaysAllowModeSwitch,
		setAlwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		setAlwaysAllowSubtasks,
		alwaysApproveResubmit,
		setAlwaysApproveResubmit,
		autoApprovalEnabled,
		setAutoApprovalEnabled,
	} = useExtensionState()

	const { t } = useAppTranslation()

	const actions: AutoApproveAction[] = [
		{
			id: "readFiles",
			label: t("chat:autoApprove.actions.readFiles.label"),
			shortName: t("chat:autoApprove.actions.readFiles.shortName"),
			enabled: alwaysAllowReadOnly ?? false,
			description: t("chat:autoApprove.actions.readFiles.description"),
		},
		{
			id: "editFiles",
			label: t("chat:autoApprove.actions.editFiles.label"),
			shortName: t("chat:autoApprove.actions.editFiles.shortName"),
			enabled: alwaysAllowWrite ?? false,
			description: t("chat:autoApprove.actions.editFiles.description"),
		},
		{
			id: "executeCommands",
			label: t("chat:autoApprove.actions.executeCommands.label"),
			shortName: t("chat:autoApprove.actions.executeCommands.shortName"),
			enabled: alwaysAllowExecute ?? false,
			description: t("chat:autoApprove.actions.executeCommands.description"),
		},
		{
			id: "useBrowser",
			label: t("chat:autoApprove.actions.useBrowser.label"),
			shortName: t("chat:autoApprove.actions.useBrowser.shortName"),
			enabled: alwaysAllowBrowser ?? false,
			description: t("chat:autoApprove.actions.useBrowser.description"),
		},
		{
			id: "useMcp",
			label: t("chat:autoApprove.actions.useMcp.label"),
			shortName: t("chat:autoApprove.actions.useMcp.shortName"),
			enabled: alwaysAllowMcp ?? false,
			description: t("chat:autoApprove.actions.useMcp.description"),
		},
		{
			id: "switchModes",
			label: t("chat:autoApprove.actions.switchModes.label"),
			shortName: t("chat:autoApprove.actions.switchModes.shortName"),
			enabled: alwaysAllowModeSwitch ?? false,
			description: t("chat:autoApprove.actions.switchModes.description"),
		},
		{
			id: "subtasks",
			label: t("chat:autoApprove.actions.subtasks.label"),
			shortName: t("chat:autoApprove.actions.subtasks.shortName"),
			enabled: alwaysAllowSubtasks ?? false,
			description: t("chat:autoApprove.actions.subtasks.description"),
		},
		{
			id: "retryRequests",
			label: t("chat:autoApprove.actions.retryRequests.label"),
			shortName: t("chat:autoApprove.actions.retryRequests.shortName"),
			enabled: alwaysApproveResubmit ?? false,
			description: t("chat:autoApprove.actions.retryRequests.description"),
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
	const handleReadOnlyChange = useCallback(() => {
		const newValue = !(alwaysAllowReadOnly ?? false)
		setAlwaysAllowReadOnly(newValue)
		vscode.postMessage({ type: "alwaysAllowReadOnly", bool: newValue })
	}, [alwaysAllowReadOnly, setAlwaysAllowReadOnly])

	const handleWriteChange = useCallback(() => {
		const newValue = !(alwaysAllowWrite ?? false)
		setAlwaysAllowWrite(newValue)
		vscode.postMessage({ type: "alwaysAllowWrite", bool: newValue })
	}, [alwaysAllowWrite, setAlwaysAllowWrite])

	const handleExecuteChange = useCallback(() => {
		const newValue = !(alwaysAllowExecute ?? false)
		setAlwaysAllowExecute(newValue)
		vscode.postMessage({ type: "alwaysAllowExecute", bool: newValue })
	}, [alwaysAllowExecute, setAlwaysAllowExecute])

	const handleBrowserChange = useCallback(() => {
		const newValue = !(alwaysAllowBrowser ?? false)
		setAlwaysAllowBrowser(newValue)
		vscode.postMessage({ type: "alwaysAllowBrowser", bool: newValue })
	}, [alwaysAllowBrowser, setAlwaysAllowBrowser])

	const handleMcpChange = useCallback(() => {
		const newValue = !(alwaysAllowMcp ?? false)
		setAlwaysAllowMcp(newValue)
		vscode.postMessage({ type: "alwaysAllowMcp", bool: newValue })
	}, [alwaysAllowMcp, setAlwaysAllowMcp])

	const handleModeSwitchChange = useCallback(() => {
		const newValue = !(alwaysAllowModeSwitch ?? false)
		setAlwaysAllowModeSwitch(newValue)
		vscode.postMessage({ type: "alwaysAllowModeSwitch", bool: newValue })
	}, [alwaysAllowModeSwitch, setAlwaysAllowModeSwitch])

	const handleSubtasksChange = useCallback(() => {
		const newValue = !(alwaysAllowSubtasks ?? false)
		setAlwaysAllowSubtasks(newValue)
		vscode.postMessage({ type: "alwaysAllowSubtasks", bool: newValue })
	}, [alwaysAllowSubtasks, setAlwaysAllowSubtasks])

	const handleRetryChange = useCallback(() => {
		const newValue = !(alwaysApproveResubmit ?? false)
		setAlwaysApproveResubmit(newValue)
		vscode.postMessage({ type: "alwaysApproveResubmit", bool: newValue })
	}, [alwaysApproveResubmit, setAlwaysApproveResubmit])

	const handleOpenSettings = useCallback(() => {
		window.postMessage({
			type: "action",
			action: "settingsButtonClicked",
			values: { section: "autoApprove" },
		})
	}, [])

	// Map action IDs to their specific handlers
	const actionHandlers: Record<AutoApproveAction["id"], () => void> = {
		readFiles: handleReadOnlyChange,
		editFiles: handleWriteChange,
		executeCommands: handleExecuteChange,
		useBrowser: handleBrowserChange,
		useMcp: handleMcpChange,
		switchModes: handleModeSwitchChange,
		subtasks: handleSubtasksChange,
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
						onChange={() => {
							const newValue = !(autoApprovalEnabled ?? false)
							setAutoApprovalEnabled(newValue)
							vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
						}}
					/>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "4px",
						flex: 1,
						minWidth: 0,
					}}>
					<span
						style={{
							color: "var(--vscode-foreground)",
							flexShrink: 0,
						}}>
						{t("chat:autoApprove.title")}
					</span>
					<span
						style={{
							color: "var(--vscode-descriptionForeground)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							flex: 1,
							minWidth: 0,
						}}>
						{enabledActionsList || t("chat:autoApprove.none")}
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
						<Trans
							i18nKey="chat:autoApprove.description"
							components={{
								settingsLink: <VSCodeLink href="#" onClick={handleOpenSettings} />,
							}}
						/>
					</div>
					{actions.map((action) => (
						<div key={action.id} style={{ margin: "6px 0" }}>
							<div onClick={(e) => e.stopPropagation()}>
								<VSCodeCheckbox checked={action.enabled} onChange={actionHandlers[action.id]}>
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
