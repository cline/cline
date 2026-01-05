import { QueuedMessage } from "@shared/ExtensionMessage"
import React, { useState } from "react"

const MAX_QUEUE_SIZE = 5

interface QueuedMessagesProps {
	queue: QueuedMessage[]
	onRemove: (index: number) => void
	onUpdate: (index: number, newText: string) => void
	onClearAll: () => void
}

const QueuedMessages: React.FC<QueuedMessagesProps> = ({ queue, onRemove, onUpdate, onClearAll }) => {
	const [editingStates, setEditingStates] = useState<Record<string, { isEditing: boolean; value: string }>>({})

	// console.log("[QueuedMessages] Component rendered:", {
	// 	queueLength: queue.length,
	// 	queue,
	// })

	if (queue.length === 0) {
		// console.log("[QueuedMessages] Queue is empty, returning null")
		return null
	}

	const getEditState = (messageId: string, currentText: string) => {
		return editingStates[messageId] || { isEditing: false, value: currentText }
	}

	const setEditState = (messageId: string, isEditing: boolean, value?: string) => {
		setEditingStates((prev) => ({
			...prev,
			[messageId]: { isEditing, value: value ?? prev[messageId]?.value ?? "" },
		}))
	}

	const handleSaveEdit = (index: number, messageId: string, newValue: string) => {
		console.log("[QueuedMessages] Saving edit:", {
			index,
			messageId,
			newValue,
		})
		onUpdate(index, newValue)
		setEditState(messageId, false)
	}

	const handleRemove = (index: number, messageId: string) => {
		console.log("[QueuedMessages] Removing message:", {
			index,
			messageId,
		})
		onRemove(index)
	}

	return (
		<div className="px-[15px] py-[10px] pr-[6px]" data-testid="queued-messages">
			<div className="flex items-center justify-between mb-2">
				<div className="text-[var(--vscode-descriptionForeground)] text-sm font-medium">
					Queued Messages ({queue.length}/{MAX_QUEUE_SIZE})
				</div>
				<button
					aria-label="Clear all queued messages"
					className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-colors"
					onClick={onClearAll}
					title="Clear all queued messages">
					<span className="codicon codicon-clear-all text-sm" />
					<span>Clear All</span>
				</button>
			</div>
			<div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
				{queue.map((message, index) => {
					const editState = getEditState(message.id, message.text)
					return (
						<div
							className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded p-2 overflow-hidden flex-shrink-0"
							key={message.id}>
							<div className="flex justify-between gap-2">
								<div className="flex-grow min-w-0">
									{editState.isEditing ? (
										<textarea
											autoFocus
											className="w-full bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] font-sans text-[13px]"
											onBlur={() => handleSaveEdit(index, message.id, editState.value)}
											onChange={(e) => setEditState(message.id, true, e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !e.shiftKey) {
													e.preventDefault()
													handleSaveEdit(index, message.id, editState.value)
												}
												if (e.key === "Escape") {
													setEditState(message.id, false, message.text)
												}
											}}
											placeholder="Edit message..."
											ref={(textarea) => {
												if (textarea) {
													// Set cursor at the end
													textarea.setSelectionRange(textarea.value.length, textarea.value.length)
												}
											}}
											rows={Math.min(editState.value.split("\n").length, 10)}
											value={editState.value}
										/>
									) : (
										<div
											className="cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] px-2 py-1 -mx-2 -my-1 rounded transition-colors whitespace-pre-wrap break-words text-[var(--vscode-editor-foreground)] text-[13px]"
											onClick={() => setEditState(message.id, true, message.text)}
											title="Click to edit">
											{message.text}
										</div>
									)}
								</div>
								<button
									aria-label="Remove message"
									className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-icon-foreground)] transition-colors"
									onClick={(e) => {
										e.stopPropagation()
										handleRemove(index, message.id)
									}}
									title="Remove from queue">
									<span className="codicon codicon-trash text-sm" />
								</button>
							</div>
							{message.images && message.images.length > 0 && (
								<div className="flex flex-wrap gap-2 mt-2">
									{message.images.map((image, imgIndex) => (
										<img
											alt={`Attachment ${imgIndex + 1}`}
											className="max-w-[100px] max-h-[100px] rounded border border-[var(--vscode-panel-border)] object-cover"
											key={imgIndex}
											src={image}
										/>
									))}
								</div>
							)}
							{message.files && message.files.length > 0 && (
								<div className="flex flex-wrap gap-2 mt-2">
									{message.files.map((file, fileIndex) => (
										<div
											className="px-2 py-1 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded text-xs flex items-center gap-1"
											key={fileIndex}>
											<span className="codicon codicon-file text-xs" />
											<span className="truncate max-w-[150px]">{file.split("/").pop()}</span>
										</div>
									))}
								</div>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default QueuedMessages
