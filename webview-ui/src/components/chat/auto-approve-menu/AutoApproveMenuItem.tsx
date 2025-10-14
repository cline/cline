import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
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
		<div className="w-full">
			<ActionButtonContainer className="w-full">
				<Tooltip>
					<TooltipContent>{action.description}</TooltipContent>
					<TooltipTrigger asChild>
						<Button
							className={cn("w-full flex text-sm items-center justify-start text-foreground gap-2")}
							onClick={(e) => onChange(e as unknown as Event)}
							size="icon"
							variant="icon">
							{onToggleFavorite && !condensed && (
								<Tooltip>
									<TooltipContent>
										{favorited ? "Remove from quick-access menu" : "Add to quick-access menu"}
									</TooltipContent>
									<TooltipTrigger asChild>
										<span
											className={cn("p-0.5 codicon", {
												"codicon-star-full text-(--vscode-terminal-ansiYellow)": favorited,
												"codicon-star-empty text-description opacity-60": !favorited,
											})}
											onClick={async (e) => {
												e.stopPropagation()
												if (action.id === "enableAll") {
													return
												}
												await onToggleFavorite?.(action.id)
											}}
										/>
									</TooltipTrigger>
								</Tooltip>
							)}
							<VSCodeCheckbox checked={checked} />
							{showIcon && <span className={`codicon ${action.icon} icon`}></span>}
							<span className="label">{condensed ? action.shortName : action.label}</span>
						</Button>
					</TooltipTrigger>
				</Tooltip>
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
		</div>
	)

	return content
}

export default AutoApproveMenuItem
