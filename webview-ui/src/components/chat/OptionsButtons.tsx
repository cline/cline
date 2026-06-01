import { AskResponseRequest } from "@shared/proto/cline/task"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { TaskServiceClient } from "@/services/grpc-client"

const OptionButton = styled.button<{ isSelected?: boolean; isNotSelectable?: boolean }>`
	padding: 8px 12px;
	background: ${(props) => (props.isSelected ? "var(--vscode-focusBorder)" : CODE_BLOCK_BG_COLOR)};
	color: ${(props) => (props.isSelected ? "white" : "var(--vscode-input-foreground)")};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 2px;
	cursor: ${(props) => (props.isNotSelectable ? "default" : "pointer")};
	text-align: left;
	font-size: 12px;

	${(props) =>
		!props.isNotSelectable &&
		`
		&:hover {
			background: var(--vscode-focusBorder);
			color: white;
		}
	`}
`

export const OptionsButtons = ({
	options,
	selected,
	isActive,
	inputValue,
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
}) => {
	if (!options?.length) {
		return null
	}

	const hasSelected = selected !== undefined && options.includes(selected)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				paddingTop: 15,
				// marginTop: "22px",
			}}>
			{/* <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px", textTransform: "uppercase" }}>
				SELECT ONE:
			</div> */}
			{options.map((option, index) => (
				<OptionButton
					className="options-button"
					id={`options-button-${index}`}
					isNotSelectable={hasSelected || !isActive}
					isSelected={option === selected}
					key={index}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						try {
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: option + (inputValue ? `: ${inputValue?.trim()}` : ""),
									images: [],
								}),
							)
						} catch (error) {
							console.error("Error sending option response:", error)
						}
					}}>
					<span className="ph-no-capture">{option}</span>
				</OptionButton>
			))}
			{/* Always offer a free-text escape hatch so the user is never boxed into the
			    model's options (mirrors Claude Code's "Other" affordance). */}
			{!hasSelected && isActive && (
				<OptionButton
					className="options-button options-button-free-text"
					id="options-button-free-text"
					key="free-text"
					onClick={async () => {
						const typed = inputValue?.trim()
						if (typed) {
							try {
								await TaskServiceClient.askResponse(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: typed,
										images: [],
									}),
								)
							} catch (error) {
								console.error("Error sending free-text response:", error)
							}
						} else {
							// Nothing typed yet — focus the chat input so the user can write their answer.
							window.dispatchEvent(new CustomEvent("focusChatInput"))
						}
					}}>
					<span style={{ opacity: 0.85 }}>✏️ Let me answer in my own words…</span>
				</OptionButton>
			)}
		</div>
	)
}
