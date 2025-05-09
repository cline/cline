import styled from "styled-components"
import HeroTooltip from "@/components/common/HeroTooltip"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { ActionMetadata } from "./AutoApproveMenu"
import { useState } from "react"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	isFavorited?: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => void
	onToggleFavorite?: (actionId: string) => void
	condensed?: boolean
}

const ActionButton = styled.div<{ isActive: boolean; isFavorited?: boolean }>`
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	border-radius: 99px;
	cursor: pointer;
	background-color: ${(props) => (props.isActive ? "#0078D4" : "#2B2B2B")};
	border: 1px solid ${(props) => (props.isActive ? "#0078D4" : "#3c3c3c")};
	transition: all 0.2s ease;

	&:hover {
		background-color: ${(props) => (props.isActive ? "#0078D4" : "#252525")};
	}

	.icon {
		color: ${(props) => (props.isActive ? "#FFFFFF" : "#CCCCCC")};
		font-size: 14px;
	}

	.label {
		color: ${(props) => (props.isActive ? "#FFFFFF" : "#CCCCCC")};
		font-size: 12px;
		font-weight: 500;
	}

	.star {
		color: ${(props) => (props.isFavorited ? "#FFCC00" : "#CCCCCC")};
		opacity: ${(props) => (props.isFavorited ? 1 : 0.6)};
		margin-left: 4px;
		font-size: 12px;
	}
`

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

const ActionButtonContainer = styled.div`
	margin: 4px;
`

const AutoApproveMenuItem = ({
	action,
	isChecked,
	isFavorited,
	onToggle,
	onToggleFavorite,
	condensed = false,
}: AutoApproveMenuItemProps) => {
	const [isSubOptionOpen, setIsSubOptionOpen] = useState(isChecked(action))
	const content = (
		<div>
			<ActionButtonContainer>
				<HeroTooltip content={action.description} placement="top">
					<ActionButton
						isActive={isChecked(action)}
						isFavorited={isFavorited?.(action)}
						onClick={(e) => {
							e.stopPropagation()
							setIsSubOptionOpen(!isSubOptionOpen)
							onToggle(action, !isChecked(action))
						}}>
						<span className={`codicon ${action.icon} icon`}></span>
						<span className="label">{condensed ? action.shortName : action.label}</span>
						{onToggleFavorite && !condensed && (
							<span
								className={`codicon codicon-${isFavorited?.(action) ? "star-full" : "star-empty"} star`}
								onClick={(e) => {
									e.stopPropagation()
									onToggleFavorite?.(action.id)
								}}
							/>
						)}
					</ActionButton>
				</HeroTooltip>
			</ActionButtonContainer>
			{action.subAction && (
				<SubOptionAnimateIn show={isSubOptionOpen}>
					<AutoApproveMenuItem
						action={action.subAction}
						isChecked={isChecked}
						isFavorited={isFavorited}
						onToggle={onToggle}
						onToggleFavorite={onToggleFavorite}
					/>
				</SubOptionAnimateIn>
			)}
		</div>
	)

	return content
}

export default AutoApproveMenuItem
