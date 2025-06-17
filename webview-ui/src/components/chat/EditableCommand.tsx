import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import React, { useState, useRef, useEffect } from "react"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"

const EditableCommandContainer = styled.div`
	border-radius: 3px;
	border: 1px solid var(--vscode-editorGroup-border);
	overflow: hidden;
	background-color: ${CODE_BLOCK_BG_COLOR};
`

const CommandHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background-color: var(--vscode-editorGroupHeader-tabsBackground);
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const CommandContent = styled.div`
	position: relative;
`

const EditButton = styled(VSCodeButton)`
	font-size: 11px;
	padding: 2px 8px;
	height: 24px;
`

const SaveCancelButtons = styled.div`
	display: flex;
	gap: 6px;
`

const StyledTextArea = styled(VSCodeTextArea)`
	width: 100%;
	min-height: 60px;
	font-family: var(--vscode-editor-font-family);
	font-size: var(--vscode-editor-font-size);
	background-color: var(--vscode-editor-background);
	border: none;
	resize: vertical;

	&:focus {
		outline: 1px solid var(--vscode-focusBorder);
	}
`

const CommandDisplay = styled.pre`
	margin: 0;
	padding: 12px;
	font-family: var(--vscode-editor-font-family);
	font-size: var(--vscode-editor-font-size);
	white-space: pre-wrap;
	word-break: break-word;
	background-color: var(--vscode-editor-background);
	color: var(--vscode-editor-foreground);
	border: none;
	overflow-x: auto;
`

interface EditableCommandProps {
	command: string
	onCommandChange: (newCommand: string) => void
	isEditing?: boolean
	onEditToggle?: (editing: boolean) => void
}

export const EditableCommand: React.FC<EditableCommandProps> = ({
	command,
	onCommandChange,
	isEditing: externalIsEditing,
	onEditToggle,
}) => {
	const [internalIsEditing, setInternalIsEditing] = useState(false)
	const [editedCommand, setEditedCommand] = useState(command)
	const textAreaRef = useRef<any>(null)

	// Use external editing state if provided, otherwise use internal state
	const isEditing = externalIsEditing !== undefined ? externalIsEditing : internalIsEditing
	const setIsEditing = onEditToggle || setInternalIsEditing

	useEffect(() => {
		setEditedCommand(command)
	}, [command])

	useEffect(() => {
		if (isEditing && textAreaRef.current) {
			const element = textAreaRef.current
			if (element && element.focus) {
				element.focus()
			}
		}
	}, [isEditing, editedCommand])

	const handleEdit = () => {
		setIsEditing(true)
	}

	const handleSave = () => {
		onCommandChange(editedCommand.trim())
		setIsEditing(false)
	}

	const handleCancel = () => {
		setEditedCommand(command)
		setIsEditing(false)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			handleSave()
		} else if (e.key === "Escape") {
			e.preventDefault()
			handleCancel()
		}
	}

	return (
		<EditableCommandContainer>
			<CommandHeader>
				<span>Command</span>
				{!isEditing ? (
					<EditButton appearance="secondary" onClick={handleEdit}>
						<i className="codicon codicon-edit" style={{ marginRight: 4 }} />
						Edit
					</EditButton>
				) : (
					<SaveCancelButtons>
						<EditButton appearance="primary" onClick={handleSave}>
							<i className="codicon codicon-check" style={{ marginRight: 4 }} />
							Save
						</EditButton>
						<EditButton appearance="secondary" onClick={handleCancel}>
							<i className="codicon codicon-close" style={{ marginRight: 4 }} />
							Cancel
						</EditButton>
					</SaveCancelButtons>
				)}
			</CommandHeader>
			<CommandContent>
				{isEditing ? (
					<StyledTextArea
						ref={textAreaRef}
						value={editedCommand}
						onChange={(e: any) => setEditedCommand((e.target as HTMLTextAreaElement).value)}
						onKeyDown={handleKeyDown}
						placeholder="Enter command..."
						rows={Math.max(3, editedCommand.split("\n").length)}
					/>
				) : (
					<CommandDisplay>{command}</CommandDisplay>
				)}
			</CommandContent>
			{isEditing && (
				<div
					style={{
						padding: "8px 12px",
						fontSize: "11px",
						color: "var(--vscode-descriptionForeground)",
						borderTop: "1px solid var(--vscode-editorGroup-border)",
						backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground)",
					}}>
					Press Ctrl+Enter to save, Escape to cancel
				</div>
			)}
		</EditableCommandContainer>
	)
}

export default EditableCommand
