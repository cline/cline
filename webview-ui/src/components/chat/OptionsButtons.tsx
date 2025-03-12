import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import { vscode } from "../../utils/vscode"

const OptionButton = styled.button<{ isSelected?: boolean; hasSelected?: boolean }>`
	padding: 8px 12px;
	background: ${(props) => (props.isSelected ? "var(--vscode-focusBorder)" : CODE_BLOCK_BG_COLOR)};
	color: ${(props) => (props.isSelected ? "white" : "var(--vscode-input-foreground)")};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 2px;
	cursor: ${(props) => (props.hasSelected ? "default" : "pointer")};
	text-align: left;
	font-size: 12px;

	${(props) =>
		!props.hasSelected &&
		`
		&:hover {
			background: var(--vscode-focusBorder);
			color: white;
		}
	`}
`

export const OptionsButtons = ({ options, selected }: { options?: string[]; selected?: string }) => {
	if (!options?.length) return null

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
			{options.map((option, index) => (
				<OptionButton
					key={index}
					isSelected={option === selected}
					hasSelected={hasSelected}
					onClick={() => {
						vscode.postMessage({
							type: "optionsResponse",
							text: option,
						})
					}}>
					{option}
				</OptionButton>
			))}
		</div>
	)
}
