import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { ActionMetadata } from "./types"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => Promise<void>
	showIcon?: boolean
	disabled?: boolean
}

const SubOptionAnimateIn = styled.div<{ show: boolean; inert?: string }>`
  position: relative;
  transform: ${(props) => (props.show ? "scaleY(1)" : "scaleY(0)")};
  transform-origin: top;
  padding-left: 24px;
  opacity: ${(props) => (props.show ? "1" : "0")};
  height: ${(props) => (props.show ? "auto" : "0")}; /* Manage height for layout */
  overflow: visible; /* Allow tooltips to escape */
  transition: transform 0.2s ease-in-out;
`

const CheckboxWrapper = styled.div<{ $disabled: boolean }>`
  padding: 2px 0.125rem;
  margin: 0;
  width: 100%;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
`

const AutoApproveMenuItem = ({ action, isChecked, onToggle, showIcon = true, disabled = false }: AutoApproveMenuItemProps) => {
	const checked = isChecked(action)

	const onChange = async (e: React.MouseEvent) => {
		if (disabled) {
			return
		}
		e.stopPropagation()
		await onToggle(action, !checked)
	}

	const content = (
		<div className="w-full" style={{ opacity: disabled ? 0.5 : 1 }}>
			<CheckboxWrapper $disabled={disabled} className="w-full" onClick={onChange}>
				<VSCodeCheckbox checked={checked} disabled={disabled}>
					<div className="w-full flex text-sm items-center justify-start text-foreground gap-2">
						{showIcon && <span className={`codicon ${action.icon} icon`}></span>}
						<span className="label">{action.label}</span>
					</div>
				</VSCodeCheckbox>
			</CheckboxWrapper>
			{action.subAction && (
				<SubOptionAnimateIn inert={!checked ? "" : undefined} show={checked}>
					<AutoApproveMenuItem action={action.subAction} isChecked={isChecked} onToggle={onToggle} />
				</SubOptionAnimateIn>
			)}
		</div>
	)

	return content
}

export default AutoApproveMenuItem
