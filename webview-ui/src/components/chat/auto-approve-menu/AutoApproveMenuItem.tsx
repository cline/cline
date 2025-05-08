import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import HeroTooltip from "@/components/common/HeroTooltip"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

interface AutoApproveMenuItemProps {
	action: {
		id: keyof AutoApprovalSettings["actions"]
		label: string
		description: string
		shortName: string
	}
	isChecked: boolean
	isFavorited: boolean
	isSubOption?: boolean
	showSubOptionChevron?: boolean
	isSubOptionExpanded?: boolean
	onToggle: (actionId: keyof AutoApprovalSettings["actions"], checked: boolean) => void
	onToggleFavorite: (actionId: string) => void
	onToggleSubOption?: (actionId: keyof AutoApprovalSettings["actions"]) => void
}

const SubOptionAnimateIn = styled.div<{ show: boolean }>`
	position: relative;
	transform: ${(props) => (props.show ? "scaleY(1)" : "scaleY(0)")};
	transform-origin: top;
	opacity: ${(props) => (props.show ? "1" : "0")};
	height: ${(props) => (props.show ? "auto" : "0")}; /* Manage height for layout */
	overflow: visible; /* Allow tooltips to escape */
	transition:
		transform 0.2s ease-in-out,
		opacity 0.2s ease-in-out,
		height 0s linear ${(props) => (props.show ? "0s" : "0.2s")};
	/* Delay height transition on hide to allow transform/opacity to finish */
`

const AutoApproveMenuItem = ({
	action,
	isChecked,
	isFavorited,
	isSubOption,
	showSubOptionChevron,
	isSubOptionExpanded,
	onToggle,
	onToggleFavorite,
	onToggleSubOption,
}: AutoApproveMenuItemProps) => {
	const content = (
		<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
			{/* Added position: relative to this div */}
			<div style={{ display: "flex", alignItems: "center", position: "relative" }}>
				<HeroTooltip content={action.description} placement="top">
					<VSCodeCheckbox
						checked={isChecked}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked
							onToggle(action.id, checked)
						}}>
						{action.label}
					</VSCodeCheckbox>
				</HeroTooltip>
				{showSubOptionChevron && (
					<span
						className={`codicon codicon-chevron-right`}
						style={{
							cursor: "pointer",
							transition: "transform 0.2s ease",
							transform: isSubOptionExpanded ? "rotate(90deg)" : "rotate(0deg)",
						}}
						onClick={() => {
							if (onToggleSubOption) {
								onToggleSubOption(action.id)
							}
						}}
					/>
				)}
			</div>
			<span
				className={`codicon codicon-${isFavorited ? "star-full" : "star-empty"}`}
				style={{
					cursor: "pointer",
					color: isFavorited ? "#FFCC00" : getAsVar(VSC_DESCRIPTION_FOREGROUND),
					opacity: isFavorited ? 1 : 0.6,
					marginRight: "4px",
				}}
				onClick={(e) => {
					e.stopPropagation()
					onToggleFavorite(action.id)
				}}
			/>
		</div>
	)

	if (isSubOption) {
		return (
			<SubOptionAnimateIn show={isSubOptionExpanded ?? false}>
				<div style={{ margin: "3px 0 6px 28px" }}>{content}</div>
			</SubOptionAnimateIn>
		)
	}

	return (
		<div
			style={{
				margin: "6px 0",
			}}>
			{content}
		</div>
	)
}

export default AutoApproveMenuItem
