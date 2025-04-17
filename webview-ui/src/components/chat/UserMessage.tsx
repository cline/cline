import React, { useState, useRef, forwardRef, useCallback } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { highlightMentions } from "./TaskHeader"
import { vscode } from "@/utils/vscode"
import DynamicTextArea from "react-textarea-autosize"

interface UserMessageProps {
	text?: string
	images?: any[] // Using any[] for now, but you might want to specify the correct type from your codebase
	messageTs?: number // Timestamp for the message, needed for checkpoint restore
	sendMessageFromChatRow?: (text: string, images: string[]) => void
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, messageTs, sendMessageFromChatRow }) => {
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(text || "")

	// Create refs for the buttons to check in the blur handler
	const restoreAllButtonRef = useRef<HTMLButtonElement>(null)
	const restoreChatButtonRef = useRef<HTMLButtonElement>(null)

	const handleClick = () => {
		if (!isEditing) {
			setIsEditing(true)
		}
	}

	const handleRestoreWorkspace = (type: string) => {
		setIsEditing(false)

		if (text === editedText) {
			return
		}

		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: type,
			offset: 1,
		})

		setTimeout(() => {
			sendMessageFromChatRow?.(editedText, images || [])
		}, 500)
	}

	const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
		// Check if focus is moving to one of our button elements
		if (e.relatedTarget === restoreAllButtonRef.current || e.relatedTarget === restoreChatButtonRef.current) {
			// Don't close edit mode if focus is moving to one of our buttons
			return
		}

		// Otherwise, close edit mode
		setIsEditing(false)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Escape") {
			setIsEditing(false)
		} else if (e.key === "Enter" && e.metaKey) {
			handleRestoreWorkspace("task")
		} else if (e.key === "Enter") {
			handleRestoreWorkspace("taskAndWorkspace")
		}
	}

	return (
		<div
			style={{
				backgroundColor: isEditing ? "unset" : "var(--vscode-badge-background)",
				color: "var(--vscode-badge-foreground)",
				borderRadius: "3px",
				padding: "9px",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
			}}
			onClick={handleClick}>
			{isEditing ? (
				<>
					<DynamicTextArea
						value={editedText}
						onChange={(e) => setEditedText(e.target.value)}
						onBlur={(e) => handleBlur(e)}
						onKeyDown={handleKeyDown}
						autoFocus
						style={{
							width: "100%",
							backgroundColor: "var(--vscode-input-background)",
							color: "var(--vscode-input-foreground)",
							borderColor: "var(--vscode-input-border)",
							border: "1px solid",
							borderRadius: "2px",
							padding: "6px",
							fontFamily: "inherit",
							fontSize: "inherit",
							lineHeight: "inherit",
							boxSizing: "border-box",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
						}}
					/>
					<div style={{ display: "flex", gap: "8px", marginTop: "8px", justifyContent: "flex-end" }}>
						<RestoreButton
							ref={restoreChatButtonRef}
							type="task"
							label="Restore Chat"
							isPrimary={false}
							onClick={handleRestoreWorkspace}
						/>
						<RestoreButton
							ref={restoreAllButtonRef}
							type="taskAndWorkspace"
							label="Restore All"
							isPrimary={true}
							onClick={handleRestoreWorkspace}
						/>
					</div>
				</>
			) : (
				<span style={{ display: "block" }}>{highlightMentions(editedText || text)}</span>
			)}
			{images && images.length > 0 && <Thumbnails images={images} style={{ marginTop: "8px" }} />}
		</div>
	)
}

// Reusable button component for restore actions
interface RestoreButtonProps {
	type: string
	label: string
	isPrimary: boolean
	onClick: (type: string) => void
}

const RestoreButton = forwardRef<HTMLButtonElement, RestoreButtonProps>(({ type, label, isPrimary, onClick }, ref) => {
	const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		onClick(type)
	}

	return (
		<button
			ref={ref}
			onClick={handleClick}
			style={{
				backgroundColor: isPrimary
					? "var(--vscode-button-background)"
					: "var(--vscode-button-secondaryBackground, var(--vscode-descriptionForeground))",
				color: isPrimary
					? "var(--vscode-button-foreground)"
					: "var(--vscode-button-secondaryForeground, var(--vscode-foreground))",
				border: "none",
				padding: "4px 8px",
				borderRadius: "2px",
				fontSize: "9px",
				cursor: "pointer",
			}}>
			{label}
		</button>
	)
})

export default UserMessage
