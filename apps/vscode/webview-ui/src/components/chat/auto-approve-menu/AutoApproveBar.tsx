import { ChevronDownIcon, ChevronRightIcon, ShieldCheckIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings } = useExtensionState()

	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	const getEnabledActionsText = () => {
		const baseClasses = isModalVisible
			? "text-[#d8dbe0] truncate"
			: "text-[#6e747d] group-hover:text-[#b8bdc6] truncate transition-colors"
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		const actionsToShow = enabledActions.filter((action) => {
			if (!action?.shortName) {
				return false
			}
			if (action.subAction?.id && enabledActionsNames.includes(action.subAction.id)) {
				return false
			}
			return true
		})

		if (actionsToShow.length === 0) {
			return <span className={baseClasses}>None</span>
		}

		return (
			<span className={baseClasses}>
				{actionsToShow.map((action, index) => (
					<span key={action?.id}>
						{action?.shortName}
						{index < actionsToShow.length - 1 && ", "}
					</span>
				))}
			</span>
		)
	}

	return (
		<div className="select-none break-words relative mb-1.5" style={style}>
			<div
				aria-label={isModalVisible ? "Close auto-approve settings" : "Open auto-approve settings"}
				className="group cursor-pointer py-1.5 px-3 flex items-center justify-between gap-2 rounded-lg hover:bg-white/[0.03] transition-colors"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						e.stopPropagation()
						setIsModalVisible((prev) => !prev)
					}
				}}
				ref={buttonRef}
				tabIndex={0}>
				<div className="flex flex-nowrap items-center gap-1.5 min-w-0 flex-1 text-[12px]">
					<ShieldCheckIcon className="shrink-0 text-[#6e747d] group-hover:text-[#9aa0a8] transition-colors" size={13} />
					<span className="whitespace-nowrap text-[#8c929b] font-medium">Auto-approve:</span>
					{getEnabledActionsText()}
				</div>
				<span className="text-[#6e747d] group-hover:text-[#b8bdc6] transition-colors">
					{isModalVisible ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
				</span>
			</div>

			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={buttonRef}
				isVisible={isModalVisible}
				setIsVisible={setIsModalVisible}
			/>
		</div>
	)
}

export default AutoApproveBar
