import { useCallback, useMemo, useState } from "react"
import { Trans } from "react-i18next"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { AutoApproveToggle, AutoApproveSetting, autoApproveSettingsConfig } from "../settings/AutoApproveToggle"

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const {
		autoApprovalEnabled,
		setAutoApprovalEnabled,
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		alwaysAllowExecute,
		alwaysAllowBrowser,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysApproveResubmit,
		setAlwaysAllowReadOnly,
		setAlwaysAllowWrite,
		setAlwaysAllowExecute,
		setAlwaysAllowBrowser,
		setAlwaysAllowMcp,
		setAlwaysAllowModeSwitch,
		setAlwaysAllowSubtasks,
		setAlwaysApproveResubmit,
	} = useExtensionState()

	const { t } = useAppTranslation()

	const onAutoApproveToggle = useCallback(
		(key: AutoApproveSetting, value: boolean) => {
			vscode.postMessage({ type: key, bool: value })

			switch (key) {
				case "alwaysAllowReadOnly":
					setAlwaysAllowReadOnly(value)
					break
				case "alwaysAllowWrite":
					setAlwaysAllowWrite(value)
					break
				case "alwaysAllowExecute":
					setAlwaysAllowExecute(value)
					break
				case "alwaysAllowBrowser":
					setAlwaysAllowBrowser(value)
					break
				case "alwaysAllowMcp":
					setAlwaysAllowMcp(value)
					break
				case "alwaysAllowModeSwitch":
					setAlwaysAllowModeSwitch(value)
					break
				case "alwaysAllowSubtasks":
					setAlwaysAllowSubtasks(value)
					break
				case "alwaysApproveResubmit":
					setAlwaysApproveResubmit(value)
					break
			}
		},
		[
			setAlwaysAllowReadOnly,
			setAlwaysAllowWrite,
			setAlwaysAllowExecute,
			setAlwaysAllowBrowser,
			setAlwaysAllowMcp,
			setAlwaysAllowModeSwitch,
			setAlwaysAllowSubtasks,
			setAlwaysApproveResubmit,
		],
	)

	const toggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), [])

	const toggles = useMemo(
		() => ({
			alwaysAllowReadOnly: alwaysAllowReadOnly,
			alwaysAllowWrite: alwaysAllowWrite,
			alwaysAllowExecute: alwaysAllowExecute,
			alwaysAllowBrowser: alwaysAllowBrowser,
			alwaysAllowMcp: alwaysAllowMcp,
			alwaysAllowModeSwitch: alwaysAllowModeSwitch,
			alwaysAllowSubtasks: alwaysAllowSubtasks,
			alwaysApproveResubmit: alwaysApproveResubmit,
		}),
		[
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowExecute,
			alwaysAllowBrowser,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysApproveResubmit,
		],
	)

	const enabledActionsList = Object.entries(toggles)
		.filter(([_key, value]) => !!value)
		.map(([key]) => t(autoApproveSettingsConfig[key as AutoApproveSetting].labelKey))
		.join(", ")

	const handleOpenSettings = useCallback(
		() =>
			window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "autoApprove" } }),
		[],
	)

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
				<div className="flex flex-col gap-2">
					<div
						style={{
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
					<AutoApproveToggle {...toggles} onToggle={onAutoApproveToggle} />
				</div>
			)}
		</div>
	)
}

export default AutoApproveMenu
