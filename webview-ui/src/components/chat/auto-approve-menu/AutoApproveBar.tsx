import { useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING, YOLO_MODE_SETTING } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings, yoloModeToggled } = useExtensionState()

	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	const getEnabledActionsText = () => {
		const baseClasses = isModalVisible
			? "text-foreground truncate"
			: "text-muted-foreground group-hover:text-foreground truncate"

		// If YOLO mode is enabled, show that instead
		if (yoloModeToggled) {
			return <span className={baseClasses}>YOLO</span>
		}
		const notificationsEnabled = autoApprovalSettings.enableNotifications
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		const actionsWithShortNames = enabledActions.filter((action) => action?.shortName)

		if (notificationsEnabled) {
			actionsWithShortNames.push(NOTIFICATIONS_SETTING)
		}

		if (actionsWithShortNames.length === 0) {
			return <span className={baseClasses}>None</span>
		}

		return (
			<span className={baseClasses}>
				{actionsWithShortNames.map((action, index) => (
					<span key={action?.id}>
						{action?.shortName}
						{index < actionsWithShortNames.length - 1 && ", "}
					</span>
				))}
			</span>
		)
	}

	return (
		<div
			className="mx-3.5 select-none overflow-y-auto break-words"
			style={{
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				borderRadius: "4px 4px 0 0",
				...style,
			}}>
			<div
				className="group cursor-pointer pt-4 pb-3.5 pr-1 px-3.5 flex items-center justify-between gap-2"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}
				ref={buttonRef}>
				<div className="flex flex-nowrap items-center gap-1 min-w-0 flex-1">
					<span className="whitespace-nowrap">Auto-approve:</span>
					{getEnabledActionsText()}
				</div>
				{isModalVisible ? (
					<span className="codicon codicon-chevron-down" />
				) : (
					<span className="codicon codicon-chevron-up" />
				)}
			</div>

			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={buttonRef}
				isVisible={isModalVisible}
				NOTIFICATIONS_SETTING={NOTIFICATIONS_SETTING}
				setIsVisible={setIsModalVisible}
				YOLO_MODE_SETTING={YOLO_MODE_SETTING}
			/>
		</div>
	)
}

export default AutoApproveBar
