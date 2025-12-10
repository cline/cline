import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"
import React, { forwardRef, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import Thumbnails from "@/components/common/Thumbnails"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CheckpointsServiceClient } from "@/services/grpc-client"
import { highlightText } from "./task-header/Highlights"

interface UserMessageProps {
	text?: string
	files?: string[]
	images?: string[]
	messageTs?: number // Timestamp for the message, needed for checkpoint restore
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, files, messageTs, sendMessageFromChatRow }) => {
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(text || "")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const { checkpointManagerErrorMessage } = useExtensionState()

	const highlightedText = useMemo(() => highlightText(editedText || text), [editedText, text])

	// Create refs for the buttons to check in the blur handler
	const restoreAllButtonRef = useRef<HTMLButtonElement>(null)
	const restoreChatButtonRef = useRef<HTMLButtonElement>(null)

	const handleClick = () => {
		if (!isEditing) {
			setIsEditing(true)
		}
	}

	// Select all text when entering edit mode
	React.useEffect(() => {
		if (isEditing && textAreaRef.current) {
			textAreaRef.current.select()
		}
	}, [isEditing])

	const handleRestoreWorkspace = async (type: ClineCheckpointRestore) => {
		const delay = type === "task" ? 500 : 1000 // Delay for task and workspace restore
		setIsEditing(false)

		if (text === editedText) {
			return
		}

		try {
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType: type,
					offset: 1,
				}),
			)

			setTimeout(() => {
				sendMessageFromChatRow?.(editedText, images || [], files || [])
			}, delay)
		} catch (err) {
			console.error("Checkpoint restore error:", err)
		}
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
		} else if (e.key === "Enter" && e.metaKey && !checkpointManagerErrorMessage) {
			handleRestoreWorkspace("taskAndWorkspace")
		} else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
			e.preventDefault()
			handleRestoreWorkspace("task")
		}
	}

	return (
		<div
			className="py-2 px-2.5"
			onClick={handleClick}
			style={{
				backgroundColor: isEditing ? "unset" : "var(--vscode-badge-background)",
				color: "var(--vscode-badge-foreground)",
				borderRadius: "3px",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
			}}>
			{isEditing ? (
				<>
					<DynamicTextArea
						autoFocus
						onBlur={(e) => handleBlur(e)}
						onChange={(e) => setEditedText(e.target.value)}
						onKeyDown={handleKeyDown}
						ref={textAreaRef}
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
						value={editedText}
					/>
					<div style={{ display: "flex", gap: "8px", marginTop: "8px", justifyContent: "flex-end" }}>
						{!checkpointManagerErrorMessage && (
							<RestoreButton
								isPrimary={false}
								label="Restore All"
								onClick={handleRestoreWorkspace}
								ref={restoreAllButtonRef}
								title="Restore both the chat and workspace files to this checkpoint and send your edited message"
								type="taskAndWorkspace"
							/>
						)}
						<RestoreButton
							isPrimary={true}
							label="Restore Chat"
							onClick={handleRestoreWorkspace}
							ref={restoreChatButtonRef}
							title="Restore just the chat to this checkpoint and send your edited message"
							type="task"
						/>
					</div>
				</>
			) : (
				<span className="ph-no-capture text-sm" style={{ display: "block" }}>
					{highlightedText}
				</span>
			)}
			{((images && images.length > 0) || (files && files.length > 0)) && (
				<Thumbnails files={files ?? []} images={images ?? []} style={{ marginTop: "8px" }} />
			)}
		</div>
	)
}

// Reusable button component for restore actions
interface RestoreButtonProps {
	type: ClineCheckpointRestore
	label: string
	isPrimary: boolean
	onClick: (type: ClineCheckpointRestore) => void
	title?: string
}

const RestoreButton = forwardRef<HTMLButtonElement, RestoreButtonProps>(({ type, label, isPrimary, onClick, title }, ref) => {
	const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		onClick(type)
	}

	return (
		<button
			onClick={handleClick}
			ref={ref}
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
			}}
			title={title}>
			{label}
		</button>
	)
})

export default UserMessage
