import { useMemo, useRef, useState } from "react"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings } = useExtensionState()
	const { isChecked, isFavorited, updateAction } = useAutoApproveActions()

	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])

	// Render a favorited item with a checkbox
	const renderFavoritedItem = (favId: string) => {
		const actions = [...ACTION_METADATA.flatMap((a) => [a, a.subAction]), NOTIFICATIONS_SETTING]
		const action = actions.find((a) => a?.id === favId)
		if (!action) {
			return null
		}

		return (
			<AutoApproveMenuItem
				action={action}
				condensed={true}
				isChecked={isChecked}
				isFavorited={isFavorited}
				onToggle={updateAction}
				showIcon={false}
			/>
		)
	}

	const getQuickAccessItems = () => {
		const notificationsEnabled = autoApprovalSettings.enableNotifications
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		const minusFavorites = enabledActions.filter((action) => !favorites.includes(action?.id ?? "") && action?.shortName)

		if (notificationsEnabled) {
			minusFavorites.push(NOTIFICATIONS_SETTING)
		}

		return [
			...favorites.map((favId) => renderFavoritedItem(favId)),
			minusFavorites.length > 0 ? (
				<span className="chip chip-emerald" key="separator">
					<span className="codicon codicon-check" style={{ fontSize: "9px" }} />
				</span>
			) : null,
			...minusFavorites.map((action) => (
				<span className="chip" key={action?.id}>
					{action?.shortName}
				</span>
			)),
		]
	}

	return (
		<div
			className="px-[10px] mx-[15px] select-none rounded-[10px_10px_0_0]"
			style={{
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				overflowY: "auto",
				backgroundColor: isModalVisible ? CODE_BLOCK_BG_COLOR : "transparent",
				...style,
			}}>
			<div
				className="cursor-pointer py-[8px] pr-[2px] flex items-center justify-between gap-[8px]"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}
				ref={buttonRef}>
				{" "}
				<div
					className="flex flex-nowrap items-center overflow-x-auto gap-2 whitespace-nowrap"
					style={{
						msOverflowStyle: "none",
						scrollbarWidth: "none",
						WebkitOverflowScrolling: "touch",
					}}>
					<span className="chip text-[10px] font-medium uppercase tracking-wider">Auto-approve</span>
					<div className="flex flex-nowrap items-center gap-1.5">{getQuickAccessItems()}</div>
				</div>
				<button
					className="modern-badge h-[22px] px-1.5 smooth-transition hover:opacity-80 cursor-pointer border-0"
					onClick={(e) => {
						e.stopPropagation()
						setIsModalVisible((prev) => !prev)
					}}>
					{isModalVisible ? (
						<span className="codicon codicon-chevron-down" style={{ fontSize: "11px" }} />
					) : (
						<span className="codicon codicon-chevron-up" style={{ fontSize: "11px" }} />
					)}
				</button>
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
