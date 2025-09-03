import { useState } from "react"
import { useTranslation } from "react-i18next"

import { QueuedMessage } from "@roo-code/types"

import { Button } from "@src/components/ui"

import Thumbnails from "../common/Thumbnails"

import { Mention } from "./Mention"

interface QueuedMessagesProps {
	queue: QueuedMessage[]
	onRemove: (index: number) => void
	onUpdate: (index: number, newText: string) => void
}

export const QueuedMessages = ({ queue, onRemove, onUpdate }: QueuedMessagesProps) => {
	const { t } = useTranslation("chat")
	const [editingStates, setEditingStates] = useState<Record<string, { isEditing: boolean; value: string }>>({})

	if (queue.length === 0) {
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
		onUpdate(index, newValue)
		setEditState(messageId, false)
	}

	return (
		<div className="px-[15px] py-[10px] pr-[6px]" data-testid="queued-messages">
			<div className="text-vscode-descriptionForeground text-md mb-2">{t("queuedMessages.title")}</div>
			<div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
				{queue.map((message, index) => {
					const editState = getEditState(message.id, message.text)

					return (
						<div
							key={message.id}
							className="bg-vscode-editor-background border rounded-xs p-1 overflow-hidden whitespace-pre-wrap flex-shrink-0">
							<div className="flex justify-between">
								<div className="flex-grow px-2 py-1 wrap-anywhere">
									{editState.isEditing ? (
										<textarea
											ref={(textarea) => {
												if (textarea) {
													// Set cursor at the end
													textarea.setSelectionRange(
														textarea.value.length,
														textarea.value.length,
													)
												}
											}}
											value={editState.value}
											onChange={(e) => setEditState(message.id, true, e.target.value)}
											onBlur={() => handleSaveEdit(index, message.id, editState.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !e.shiftKey) {
													e.preventDefault()
													handleSaveEdit(index, message.id, editState.value)
												}
												if (e.key === "Escape") {
													setEditState(message.id, false, message.text)
												}
											}}
											className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 resize-none focus:outline-0 focus:ring-1 focus:ring-vscode-focusBorder"
											placeholder={t("chat:editMessage.placeholder")}
											autoFocus
											rows={Math.min(editState.value.split("\n").length, 10)}
										/>
									) : (
										<div
											onClick={() => setEditState(message.id, true, message.text)}
											className="cursor-pointer hover:bg-vscode-list-hoverBackground px-1 py-0.5 -mx-1 -my-0.5 rounded transition-colors"
											title={t("chat:queuedMessages.clickToEdit")}>
											<Mention text={message.text} withShadow />
										</div>
									)}
								</div>
								<div className="flex">
									<Button
										variant="ghost"
										size="icon"
										className="shrink-0"
										onClick={(e) => {
											e.stopPropagation()
											onRemove(index)
										}}>
										<span className="codicon codicon-trash" />
									</Button>
								</div>
							</div>
							{message.images && message.images.length > 0 && (
								<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
