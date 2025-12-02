import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ActionMetadata } from "./types"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => Promise<void>
	showIcon?: boolean
	disabled?: boolean
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

const AutoApproveMenuItem = ({ action, isChecked, onToggle, showIcon = true, disabled = false }: AutoApproveMenuItemProps) => {
	const checked = isChecked(action)

	const onChange = async (e: Event) => {
		if (disabled) {
			return
		}
		e.stopPropagation()
		await onToggle(action, !checked)
	}

	const content = (
		<div className="w-full" style={{ opacity: disabled ? 0.5 : 1 }}>
			<ActionButtonContainer className="w-full">
				<Button
					className={cn("w-full flex text-sm items-center justify-start text-foreground gap-2")}
					disabled={disabled}
					onClick={(e) => onChange(e as unknown as Event)}
					size="icon"
					style={{ cursor: disabled ? "not-allowed" : "pointer" }}
					variant="icon">
					<VSCodeCheckbox checked={checked} disabled={disabled} />
					{showIcon && <span className={`codicon ${action.icon} icon`}></span>}
					<span className="label">{action.label}</span>
				</Button>
			</ActionButtonContainer>
			{action.subAction && (
				<SubOptionAnimateIn show={checked}>
					<AutoApproveMenuItem action={action.subAction} isChecked={isChecked} onToggle={onToggle} />
				</SubOptionAnimateIn>
			)}
		</div>
	)

	return content
}

export default AutoApproveMenuItem
