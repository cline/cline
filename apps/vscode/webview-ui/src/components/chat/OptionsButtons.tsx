import { AskResponseRequest } from "@shared/proto/cline/task"
import { CheckIcon } from "lucide-react"
import { useState } from "react"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { TaskServiceClient } from "@/services/grpc-client"

const OptionButton = styled.button<{ $isSelected?: boolean; $isNotSelectable?: boolean }>`
	padding: 8px 12px;
	/* The chosen option stays marked once the question is answered. Badge colours are used
	   rather than the hover colour so "selected" and "pointing at it" never look the same, and
	   a check icon carries the same message without relying on colour alone. */
	background: ${(props) => (props.$isSelected ? "var(--vscode-badge-background)" : CODE_BLOCK_BG_COLOR)};
	color: ${(props) => (props.$isSelected ? "var(--vscode-badge-foreground)" : "var(--vscode-input-foreground)")};
	border: 1px solid
		${(props) => (props.$isSelected ? "var(--vscode-textLink-foreground)" : "var(--vscode-editorGroup-border)")};
	${(props) => props.$isSelected && "font-weight: 600;"}
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
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
}) => {
	const optionItems = options ?? []
	const optionsKey = optionItems.join("\u0000")
	const optimisticSelectionKey = `${selected ?? ""}\u0001${optionsKey}`
	const [optimisticSelection, setOptimisticSelection] = useState<{ key: string; option: string }>()

	if (!optionItems.length) {
		return null
	}

	const selectedOption =
		selected !== undefined && optionItems.includes(selected)
			? selected
			: optimisticSelection?.key === optimisticSelectionKey
				? optimisticSelection.option
				: undefined
	const hasSelected = selectedOption !== undefined && optionItems.includes(selectedOption)

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
			{optionItems.map((option, index) => (
				<OptionButton
					$isNotSelectable={hasSelected || !isActive}
					$isSelected={option === selectedOption}
					className="options-button"
					disabled={hasSelected || !isActive}
					id={`options-button-${index}`}
					key={option}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						setOptimisticSelection({ key: optimisticSelectionKey, option })
						try {
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: option + (inputValue ? `: ${inputValue?.trim()}` : ""),
									images: [],
								}),
							)
						} catch (error) {
							setOptimisticSelection(undefined)
							console.error("Error sending option response:", error)
						}
					}}>
					{option === selectedOption && <CheckIcon aria-hidden className="size-3 shrink-0 mr-1.5 inline-block" />}
					<span className="ph-no-capture">{option}</span>
				</OptionButton>
			))}
		</div>
	)
}
