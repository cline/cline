import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { AiHydroCheckpointRestore } from "@shared/WebviewMessage"
import { User } from "lucide-react"
import React, { forwardRef, useRef, useState } from "react"
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

	const handleRestoreWorkspace = async (type: AiHydroCheckpointRestore) => {
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
			className={`user-message ${isEditing ? "user-message--editing" : "message-bubble-user animate-message-in-right user-message--display"}`}
			onClick={handleClick}>
			{isEditing ? (
				<>
					<DynamicTextArea
						autoFocus
						className="user-message-textarea"
						onBlur={(e) => handleBlur(e)}
						onChange={(e) => setEditedText(e.target.value)}
						onKeyDown={handleKeyDown}
						ref={textAreaRef}
						value={editedText}
					/>
					<div className="user-message-btn-row">
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
				<div className="flex items-start gap-2">
					<div
						className="user-message-avatar"
						style={{
							background: `linear-gradient(135deg, var(--ai-hydro-ocean-blue) 0%, var(--ai-hydro-teal) 100%)`,
							boxShadow: `0 0 8px color-mix(in srgb, var(--ai-hydro-ocean-blue) 30%, transparent)`,
						}}>
						<User className="text-white" size={14} />
					</div>
					<span className="ph-no-capture flex-1 min-w-0 user-message-text">{highlightText(editedText || text)}</span>
				</div>
			)}
			{((images && images.length > 0) || (files && files.length > 0)) && (
				<Thumbnails className="mt-2" files={files ?? []} images={images ?? []} />
			)}
		</div>
	)
}

// Reusable button component for restore actions
interface RestoreButtonProps {
	type: AiHydroCheckpointRestore
	label: string
	isPrimary: boolean
	onClick: (type: AiHydroCheckpointRestore) => void
	title?: string
}

const RestoreButton = forwardRef<HTMLButtonElement, RestoreButtonProps>(({ type, label, isPrimary, onClick, title }, ref) => {
	const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		onClick(type)
	}

	return (
		<button
			className={`restore-btn ${isPrimary ? "restore-btn--primary" : "restore-btn--secondary"}`}
			onClick={handleClick}
			ref={ref}
			title={title}>
			{label}
		</button>
	)
})

export default UserMessage
