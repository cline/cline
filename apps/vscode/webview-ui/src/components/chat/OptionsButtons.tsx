import { AskResponseRequest } from "@shared/proto/cline/task"
import { useEffect, useMemo, useState } from "react"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { TaskServiceClient } from "@/services/grpc-client"

const OptionButton = styled.button<{ $isSelected?: boolean; $isNotSelectable?: boolean }>`
	padding: 8px 12px;
	background: ${(props) => (props.$isSelected ? "var(--vscode-focusBorder)" : CODE_BLOCK_BG_COLOR)};
	color: ${(props) => (props.$isSelected ? "white" : "var(--vscode-input-foreground)")};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 2px;
	cursor: ${(props) => (props.$isNotSelectable ? "default" : "pointer")};
	text-align: left;
	font-size: 12px;

	${(props) =>
		!props.$isNotSelectable &&
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
	onOptimisticUserMessage,
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
	onOptimisticUserMessage?: (text: string, images?: string[], files?: string[]) => () => void
}) => {
	const [pendingSelected, setPendingSelected] = useState<string | undefined>()
	const optionsKey = useMemo(() => options?.join("\0") ?? "", [options])
	const effectiveSelected = selected ?? pendingSelected
	const hasSelected = effectiveSelected !== undefined && !!options?.includes(effectiveSelected)

	useEffect(() => {
		setPendingSelected(undefined)
	}, [isActive, selected, optionsKey])

	if (!options?.length) {
		return null
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
			}}>
			{/* <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px", textTransform: "uppercase" }}>
				SELECT ONE:
			</div> */}
			{options.map((option, index) => (
				<OptionButton
					$isNotSelectable={hasSelected || !isActive}
					$isSelected={option === effectiveSelected}
					className="options-button"
					id={`options-button-${index}`}
					key={option}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						const responseText = option + (inputValue ? `: ${inputValue?.trim()}` : "")
						setPendingSelected(option)
						const removeOptimisticMessage = onOptimisticUserMessage?.(responseText, [], []) ?? (() => {})
						try {
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: responseText,
									images: [],
								}),
							)
						} catch (error) {
							removeOptimisticMessage()
							setPendingSelected(undefined)
							console.error("Error sending option response:", error)
						}
					}}>
					<span className="ph-no-capture">{option}</span>
				</OptionButton>
			))}
		</div>
	)
}
