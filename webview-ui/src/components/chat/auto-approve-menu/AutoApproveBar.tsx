import { useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA, YOLO_MODE_SETTING } from "./constants"

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
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		const actionsWithShortNames = enabledActions.filter((action) => action?.shortName)

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

	const borderColor = `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`
	const borderGradient = `linear-gradient(to bottom, ${borderColor} 0%, transparent 50%)`
	const bgGradient = `linear-gradient(to bottom, color-mix(in srgb, var(--vscode-sideBar-background) 96%, white) 0%, transparent 80%)`

	return (
		<div
			className="mx-3.5 select-none break-words relative"
			style={{
				borderTop: `0.5px solid ${borderColor}`,
				borderRadius: "4px 4px 0 0",
				background: bgGradient,
				...style,
			}}>
			{/* Left border gradient */}
			<div
				className="absolute left-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>
			{/* Right border gradient */}
			<div
				className="absolute right-0 top-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>

			<div
				className="group cursor-pointer pt-4 pb-3.5 pr-2 px-3.5 flex items-center justify-between gap-0"
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
				setIsVisible={setIsModalVisible}
				YOLO_MODE_SETTING={YOLO_MODE_SETTING}
			/>
		</div>
	)
}

export default AutoApproveBar
