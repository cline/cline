import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { AutoApprovalSettings } from "../../../../src/shared/AutoApprovalSettings"
import { vscode } from "../../utils/vscode"
import { getAsVar, VSC_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "../../utils/vscStyles"

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
		label: "读取文件和目录",
		shortName: "读取",
		description: "允许访问读取您电脑上的任何文件。",
	},
	{
		id: "editFiles",
		label: "编辑文件",
		shortName: "编辑",
		description: "允许修改您电脑上的任何文件。",
	},
	{
		id: "executeCommands",
		label: "执行安全命令",
		shortName: "命令",
		description: "允许执行安全的终端命令。如果模型认为命令可能具有破坏性，仍需要批准。",
	},
	{
		id: "useBrowser",
		label: "使用浏览器",
		shortName: "浏览器",
		description: "允许在无头浏览器中启动并与任何网站交互。",
	},
	{
		id: "useMcp",
		label: "使用MCP服务器",
		shortName: "MCP",
		description: "允许使用配置的MCP服务器，这些服务器可能会修改文件系统或与API交互。",
	},
]

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	const [isHoveringCollapsibleSection, setIsHoveringCollapsibleSection] = useState(false)

	// Careful not to use partials to mutate since spread operator only does shallow copy

	const enabledActions = ACTION_METADATA.filter((action) => autoApprovalSettings.actions[action.id])
	const enabledActionsList = enabledActions.map((action) => action.shortName).join(", ")
	const hasEnabledActions = enabledActions.length > 0

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
			// Calculate what the new actions state will be
			const newActions = {
				...autoApprovalSettings.actions,
				[actionId]: value,
			}

			// Check if this will result in any enabled actions
			const willHaveEnabledActions = Object.values(newActions).some(Boolean)

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					actions: newActions,
					// If no actions will be enabled, ensure the main toggle is off
					enabled: willHaveEnabledActions ? autoApprovalSettings.enabled : false,
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

	return (
		<div
			style={{
				padding: "0 15px",
				userSelect: "none",
				borderTop: isExpanded
					? `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`
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
					cursor: !hasEnabledActions ? "pointer" : "default",
				}}
				onMouseEnter={() => {
					if (!hasEnabledActions) {
						setIsHoveringCollapsibleSection(true)
					}
				}}
				onMouseLeave={() => {
					if (!hasEnabledActions) {
						setIsHoveringCollapsibleSection(false)
					}
				}}
				onClick={() => {
					if (!hasEnabledActions) {
						setIsExpanded((prev) => !prev)
					}
				}}>
				<VSCodeCheckbox
					style={{
						pointerEvents: hasEnabledActions ? "auto" : "none",
					}}
					checked={hasEnabledActions && autoApprovalSettings.enabled}
					disabled={!hasEnabledActions}
					// onChange={(e) => {
					// 	const checked = (e.target as HTMLInputElement).checked
					// 	updateEnabled(checked)
					// }}
					onClick={(e) => {
						/*
						vscode web toolkit bug: when changing the value of a vscodecheckbox programmatically, it will call its onChange with stale state. This led to updateEnabled being called with an old version of autoApprovalSettings, effectively undoing the state change that was triggered by the last action being unchecked. A simple workaround is to just not use onChange and instead use onClick. We are lucky this is a checkbox and the newvalue is simply opposite of current state.
						*/
						if (!hasEnabledActions) return
						e.stopPropagation() // stops click from bubbling up to the parent, in this case stopping the expanding/collapsing
						updateEnabled(!autoApprovalSettings.enabled)
					}}
				/>
				<CollapsibleSection
					isHovered={isHoveringCollapsibleSection}
					style={{ cursor: "pointer" }}
					onClick={() => {
						// to prevent this from counteracting parent
						if (hasEnabledActions) {
							setIsExpanded((prev) => !prev)
						}
					}}>
					<span
						style={{
							color: getAsVar(VSC_FOREGROUND),
							whiteSpace: "nowrap",
						}}>
						自动批准：
					</span>
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
							color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
							fontSize: "12px",
						}}>
						自动批准允许 Cline 在不询问的情况下执行以下操作。请谨慎使用，并确保您了解相关风险。
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
									color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
									fontSize: "12px",
								}}>
								{action.description}
							</div>
						</div>
					))}
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
							alignItems: "center",
							gap: "8px",
							marginTop: "10px",
							marginBottom: "8px",
							color: getAsVar(VSC_FOREGROUND),
						}}>
						<span style={{ flexShrink: 1, minWidth: 0 }}>最大请求数：</span>
						<VSCodeTextField
							// placeholder={DEFAULT_AUTO_APPROVAL_SETTINGS.maxRequests.toString()}
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
								if (!/^\d$/.test(e.key) && !["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(e.key)) {
									e.preventDefault()
								}
							}}
							style={{ flex: 1 }}
						/>
					</div>
					<div
						style={{
							color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
							fontSize: "12px",
							marginBottom: "10px",
						}}>
						在达到此数量的API请求后，Cline将会请求您的批准以继续执行任务。
					</div>
					<div style={{ margin: "6px 0" }}>
						<VSCodeCheckbox
							checked={autoApprovalSettings.enableNotifications}
							onChange={(e) => {
								const checked = (e.target as HTMLInputElement).checked
								updateNotifications(checked)
							}}>
							启用通知
						</VSCodeCheckbox>
						<div
							style={{
								marginLeft: "28px",
								color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
								fontSize: "12px",
							}}>
							当 Cline 需要您的批准或任务完成时，您将收到系统通知。
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

const CollapsibleSection = styled.div<{ isHovered?: boolean }>`
	display: flex;
	align-items: center;
	gap: 4px;
	color: ${(props) => (props.isHovered ? getAsVar(VSC_FOREGROUND) : getAsVar(VSC_DESCRIPTION_FOREGROUND))};
	flex: 1;
	min-width: 0;

	&:hover {
		color: ${getAsVar(VSC_FOREGROUND)};
	}
`

export default AutoApproveMenu
