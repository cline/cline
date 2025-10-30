import { useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings } = useExtensionState()

	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	const getEnabledActionsText = () => {
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
			return <span className="text-muted-foreground truncate">None</span>
		}

		return (
			<span className="text-muted-foreground truncate">
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
				className="cursor-pointer py-1 pr-1 px-3.5 flex items-center justify-between gap-2"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}
				ref={buttonRef}>
				<div className="flex flex-nowrap items-center gap-1 min-w-0 flex-1">
					<span className="whitespace-nowrap">Auto-approve{!isModalVisible ? ":" : ""}</span>
					{!isModalVisible && getEnabledActionsText()}
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
			/>
		</div>
	)
}

export default AutoApproveBar
