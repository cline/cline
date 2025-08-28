import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import styled from "styled-components"
import HeroTooltip from "@/components/common/HeroTooltip"
import { ActionMetadata } from "./types"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	isFavorited?: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => Promise<void>
	onToggleFavorite?: (actionId: string) => Promise<void>
	condensed?: boolean
	showIcon?: boolean
}

const CheckboxContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isFavorited"].includes(prop),
})<{ isFavorited?: boolean; onClick?: (e: MouseEvent) => void; onMouseDown?: (e: React.MouseEvent) => void }>`
	display: flex;
	align-items: center;
	justify-content: space-between; /* Push content to edges */
	padding-left: 4px;
	padding-right: 1px;
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
		font-size: 14px;
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
	padding: 2px;
`

const AutoApproveMenuItem = ({
	action,
	isChecked,
	isFavorited,
	onToggle,
	onToggleFavorite,
	condensed = false,
	showIcon = true,
}: AutoApproveMenuItemProps) => {
	const checked = isChecked(action)
	const favorited = isFavorited?.(action)

	const onChange = async (e: Event) => {
		e.stopPropagation()
		await onToggle(action, !checked)
	}

	const content = (
		<>
			<ActionButtonContainer>
				<HeroTooltip content={action.description} delay={500}>
					<CheckboxContainer isFavorited={favorited} onClick={onChange}>
						<div className="left-content">
							{onToggleFavorite && !condensed && (
								<HeroTooltip
									content={favorited ? "Remove from quick-access menu" : "Add to quick-access menu"}
									delay={500}>
									<span
										className={`p-0.5 codicon codicon-${favorited ? "star-full" : "star-empty"} star`}
										onClick={async (e) => {
											e.stopPropagation()
											if (action.id === "enableAll") {
												return
											}
											await onToggleFavorite?.(action.id)
										}}
										style={{
											cursor: "pointer",
										}}
									/>
								</HeroTooltip>
							)}
							<VSCodeCheckbox checked={checked} />
							{showIcon && <span className={`codicon ${action.icon} icon`}></span>}
							<span className="label">{condensed ? action.shortName : action.label}</span>
						</div>
					</CheckboxContainer>
				</HeroTooltip>
			</ActionButtonContainer>
			{action.subAction && !condensed && (
				<SubOptionAnimateIn show={checked}>
					<AutoApproveMenuItem
						action={action.subAction}
						isChecked={isChecked}
						isFavorited={isFavorited}
						onToggle={onToggle}
						onToggleFavorite={onToggleFavorite}
					/>
				</SubOptionAnimateIn>
			)}
		</>
	)

	return content
}

export default AutoApproveMenuItem
