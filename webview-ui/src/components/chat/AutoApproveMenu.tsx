import { useCallback, useMemo, useState } from "react"
import { Trans } from "react-i18next"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { cn } from "@/lib/utils"
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
			className={cn(
				"px-[15px] select-none overflow-y-auto",
				isExpanded && "border-t-[0.5px] border-vscode-titleBar-inactiveForeground-20",
			)}
			style={style}>
			<div
				className={`flex items-center gap-2 cursor-pointer ${isExpanded ? "py-2" : "pt-2 pb-0"}`}
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
				<div className="flex items-center gap-1 flex-1 min-w-0">
					<span className="text-vscode-foreground flex-shrink-0">{t("chat:autoApprove.title")}</span>
					<span className="text-vscode-descriptionForeground overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
						{enabledActionsList || t("chat:autoApprove.none")}
					</span>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} flex-shrink-0 ${
							isExpanded ? "ml-0.5" : "ml-[-2px]"
						}`}
					/>
				</div>
			</div>

			{isExpanded && (
				<div className="flex flex-col gap-2">
					<div className="text-vscode-descriptionForeground text-xs">
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
