import React, { type ChangeEvent, type ChangeEventHandler } from "react"
import styled from "styled-components"
import HeroTooltip from "@/components/common/HeroTooltip"
import { ActionMetadata } from "./AutoApproveMenu"
import { useState } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	isFavorited?: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => void
	onToggleFavorite?: (actionId: string) => void
	condensed?: boolean
}

const CheckboxContainer = styled.div<{
	isFavorited?: boolean
	onClick?: (e: MouseEvent) => void
	onMouseDown?: (e: React.MouseEvent) => void
}>`
	display: flex;
	align-items: center;
	justify-content: space-between; /* Push content to edges */
	padding: 0 4px;
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: var(--vscode-textBlockQuote-background);
	}

	.left-content {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.icon {
		color: var(--vscode-foreground);
		font-size: 14px;
	}

	.label {
		color: var(--vscode-foreground);
		font-size: 12px;
		font-weight: 500;
	}

	.star {
		color: ${(props) => (props.isFavorited ? "var(--vscode-terminal-ansiYellow)" : "var(--vscode-descriptionForeground)")};
		opacity: ${(props) => (props.isFavorited ? 1 : 0.6)};
		font-size: 12px;
	}
`

const SubOptionAnimateIn = styled.div<{ show: boolean }>`
	position: relative;
	transform: ${(props) => (props.show ? "scaleY(1)" : "scaleY(0)")};
	transform-origin: top;
	padding-left: 24px;
	opacity: ${(props) => (props.show ? "1" : "0")};
	height: ${(props) => (props.show ? "auto" : "0")}; /* Manage height for layout */
	overflow: visible; /* Allow tooltips to escape */
	transition: transform 0.2s ease-in-out;
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
	const checked = isChecked(action)
	const favorited = isFavorited?.(action)

	const onChange = (e: Event) => {
		e.stopPropagation()
		const newChecked = !checked
		setIsSubOptionOpen(newChecked)
		onToggle(action, newChecked)
	}

	const content = (
		<div>
			<ActionButtonContainer>
				<HeroTooltip content={action.description} delay={200}>
					<CheckboxContainer isFavorited={favorited} onClick={onChange}>
						<div className="left-content">
							<VSCodeCheckbox checked={checked} />
							<span className={`codicon ${action.icon} icon`}></span>
							<span className="label">{condensed ? action.shortName : action.label}</span>
						</div>
						{onToggleFavorite && !condensed && (
							<span
								className={`codicon codicon-${favorited ? "star-full" : "star-empty"} star`}
								onClick={(e) => {
									e.stopPropagation()
									onToggleFavorite?.(action.id)
								}}
							/>
						)}
					</CheckboxContainer>
				</HeroTooltip>
			</ActionButtonContainer>
			{action.subAction && !condensed && (
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
