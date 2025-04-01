import React, { useState } from "react"
import styled from "styled-components"
import MarkdownBlock from "../common/MarkdownBlock"
import SuccessButton from "../common/SuccessButton"
import { vscode } from "../../utils/vscode"

const PreviewContainer = styled.div`
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 4px;
	margin-top: 10px;
	overflow: hidden;
`

const PreviewHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background-color: var(--vscode-editorGroupHeader-tabsBackground);
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	cursor: pointer;
`

const PreviewTitle = styled.div`
	font-weight: 500;
	display: flex;
	align-items: center;
	gap: 6px;
`

const PreviewContent = styled.div<{ expanded: boolean }>`
	padding: ${(props) => (props.expanded ? "12px" : "0")};
	max-height: ${(props) => (props.expanded ? "400px" : "0")};
	overflow-y: auto;
	transition:
		max-height 0.2s ease-out,
		padding 0.2s ease-out;
`

const ButtonContainer = styled.div`
	margin-top: 12px;
	display: flex;
	justify-content: flex-end;
`

interface NewTaskPreviewProps {
	context: string
	isActive: boolean
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context, isActive }) => {
	const [expanded, setExpanded] = useState(false)
	const [isCreating, setIsCreating] = useState(false)

	const handleCreateNewTask = () => {
		if (!isActive || isCreating) return

		setIsCreating(true)
		vscode.postMessage({
			type: "newTask",
			text: context,
		})
	}

	return (
		<div>
			<PreviewContainer>
				<PreviewHeader onClick={() => setExpanded(!expanded)}>
					<PreviewTitle>
						<span className="codicon codicon-new-file"></span>
						New Task Context Preview
					</PreviewTitle>
					<span className={`codicon codicon-chevron-${expanded ? "down" : "right"}`}></span>
				</PreviewHeader>
				<PreviewContent expanded={expanded}>
					<MarkdownBlock markdown={context} />
				</PreviewContent>
			</PreviewContainer>
			<ButtonContainer>
				<SuccessButton
					onClick={handleCreateNewTask}
					disabled={!isActive || isCreating}
					style={{
						cursor: !isActive || isCreating ? "not-allowed" : "pointer",
						opacity: !isActive ? 0.7 : 1,
					}}>
					{isCreating ? (
						<>
							<span className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: "8px" }}></span>
							Creating New Task...
						</>
					) : (
						<>
							<span className="codicon codicon-new-file" style={{ marginRight: "8px" }}></span>
							Create New Task
						</>
					)}
				</SuccessButton>
			</ButtonContainer>
		</div>
	)
}

export default NewTaskPreview
