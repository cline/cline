import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { AutoRunSettings } from "../../../../src/shared/AutoRunSettings"
import { vscode } from "../../utils/vscode"
import { getAsVar, VSC_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "../../utils/vscStyles"

interface AutoRunMenuProps {
	style?: React.CSSProperties
}

const AutoRunMenu = ({ style }: AutoRunMenuProps) => {
	const { autoRunSettings } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	const [isHoveringCollapsibleSection, setIsHoveringCollapsibleSection] = useState(false)

	const updateEnabled = useCallback(
		(enabled: boolean) => {
			vscode.postMessage({
				type: "autoRunSettings",
				autoRunSettings: {
					...autoRunSettings,
					enabled,
				},
			})
		},
		[autoRunSettings],
	)

	const updateCommand = useCallback(
		(command: string) => {
			vscode.postMessage({
				type: "autoRunSettings",
				autoRunSettings: {
					...autoRunSettings,
					command,
				},
			})
		},
		[autoRunSettings],
	)

	return (
		<div
			style={{
				padding: "0 15px",
				userSelect: "none",
				borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
				overflowY: "auto",
				...style,
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					padding: isExpanded ? "8px 0" : "8px 0 0 0",
					cursor: "pointer",
				}}
				onMouseEnter={() => {
					setIsHoveringCollapsibleSection(true)
				}}
				onMouseLeave={() => {
					setIsHoveringCollapsibleSection(false)
				}}
				onClick={() => {
					setIsExpanded((prev) => !prev)
				}}>
				<VSCodeCheckbox
					checked={autoRunSettings.enabled}
					onClick={(e) => {
						e.stopPropagation() // stops click from bubbling up to the parent
						updateEnabled(!autoRunSettings.enabled)
					}}
				/>
				<CollapsibleSection isHovered={isHoveringCollapsibleSection} style={{ cursor: "pointer" }}>
					<span
						style={{
							color: getAsVar(VSC_FOREGROUND),
							whiteSpace: "nowrap",
						}}>
						Auto-run:
					</span>
					<span
						style={{
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}>
						{autoRunSettings.enabled ? (autoRunSettings.command || "No command") : "Disabled"}
					</span>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
						style={{
							flexShrink: 0,
							marginLeft: isExpanded ? "2px" : "-2px",
						}}
					/>
				</CollapsibleSection>
			</div>
			{isExpanded && (
				<div style={{ padding: "0" }}>
					<div
						style={{
							marginBottom: "10px",
							color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
							fontSize: "12px",
						}}>
						Auto-run automatically executes your specified command whenever Cline saves a file. The output is sent directly to Cline for context, making it ideal for running tests, linters, or other processes that should trigger on save.
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							marginTop: "10px",
							marginBottom: "8px",
							color: getAsVar(VSC_FOREGROUND),
						}}>
						<span style={{ flexShrink: 1, minWidth: 0 }}>Command:</span>
						<VSCodeTextField
							placeholder="Enter command to run after file save"
							value={autoRunSettings.command}
							onInput={(e) => {
								const input = e.target as HTMLInputElement
								updateCommand(input.value)
							}}
							style={{ flex: 1 }}
							disabled={!autoRunSettings.enabled}
						/>
					</div>
				</div>
			)}
		</div>
	)
}

const CollapsibleSection = styled.div<{ isHovered?: boolean }>`
	display: flex;
	align-items: center;
	gap: 4px;
	color: ${(props) => (props.isHovered ? getAsVar(VSC_FOREGROUND) : getAsVar(VSC_DESCRIPTION_FOREGROUND))};
	flex: 1;
	min-width: 0;

	&:hover {
		color: ${getAsVar(VSC_FOREGROUND)};
	}
`

export default AutoRunMenu
