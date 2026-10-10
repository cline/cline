import type { QueuedPrompt } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { ReorderQueuedPromptRequest, UpdateQueuedPromptRequest } from "@shared/proto/cline/task"
import { useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

function truncatePrompt(prompt: string): string {
	const trimmed = prompt.trim()
	return trimmed.length > 96 ? `${trimmed.slice(0, 96)}...` : trimmed
}

function attachmentLabel(count: number): string | undefined {
	if (count <= 0) {
		return undefined
	}
	return count === 1 ? "1 attachment" : `${count} attachments`
}

function queueSummary(items: QueuedPrompt[]): string {
	const steerCount = items.filter((item) => item.delivery === "steer").length
	const queueCount = items.length - steerCount
	if (steerCount === 0) {
		return items.length === 1 ? "Queued message" : `${items.length} queued messages`
	}
	if (queueCount === 0) {
		return items.length === 1 ? "Steering message" : `${items.length} steering messages`
	}
	return `${queueCount} queued, ${steerCount} steering`
}

interface QueuedPromptsProps {
	items?: QueuedPrompt[]
}

export function QueuedPrompts({ items = [] }: QueuedPromptsProps) {
	const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set())
	const [mutatingIds, setMutatingIds] = useState<Set<string>>(() => new Set())
	const [draggingId, setDraggingId] = useState<string | null>(null)
	const [overId, setOverId] = useState<string | null>(null)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editValue, setEditValue] = useState("")

	if (items.length === 0) {
		return null
	}

	const cancelQueuedPrompt = (promptId: string) => {
		setCancellingIds((current) => new Set(current).add(promptId))
		TaskServiceClient.cancelQueuedPrompt(StringRequest.create({ value: promptId }))
			.catch((error) => {
				console.error("Failed to cancel queued prompt:", error)
			})
			.finally(() => {
				setCancellingIds((current) => {
					const next = new Set(current)
					next.delete(promptId)
					return next
				})
			})
	}

	const startEdit = (item: QueuedPrompt) => {
		setEditingId(item.id)
		setEditValue(item.prompt)
	}

	const saveEdit = async (item: QueuedPrompt) => {
		const prompt = editValue.trim()
		if (!prompt || editingId !== item.id) {
			setEditingId(null)
			return
		}
		setMutatingIds((current) => new Set(current).add(item.id))
		try {
			await TaskServiceClient.updateQueuedPrompt(
				UpdateQueuedPromptRequest.create({ promptId: item.id, prompt }),
			)
		} catch (error) {
			console.error("Failed to update queued prompt:", error)
		} finally {
			setMutatingIds((current) => {
				const next = new Set(current)
				next.delete(item.id)
				return next
			})
			setEditingId(null)
		}
	}

	const handleDrop = async (targetId: string) => {
		const sourceId = draggingId
		setDraggingId(null)
		setOverId(null)
		if (!sourceId || sourceId === targetId) {
			return
		}
		const fromIndex = items.findIndex((item) => item.id === sourceId)
		let toIndex = items.findIndex((item) => item.id === targetId)
		if (fromIndex < 0 || toIndex < 0) {
			return
		}
		// Compute the final queue index the source would land at after removal.
		const list = [...items]
		const [moved] = list.splice(fromIndex, 1)
		if (!moved) {
			return
		}
		if (toIndex > fromIndex) {
			toIndex -= 1
		}
		list.splice(toIndex, 0, moved)
		const finalIndex = list.findIndex((item) => item.id === sourceId)
		setMutatingIds((current) => new Set(current).add(sourceId))
		try {
			await TaskServiceClient.reorderQueuedPrompt(
				ReorderQueuedPromptRequest.create({ promptId: sourceId, position: finalIndex }),
			)
		} catch (error) {
			console.error("Failed to reorder queued prompt:", error)
		} finally {
			setMutatingIds((current) => {
				const next = new Set(current)
				next.delete(sourceId)
				return next
			})
		}
	}

	return (
		<div className="mx-3 mt-2.5 mb-2.5 rounded-xs border border-editor-group-border bg-code/70 px-2.5 py-2 shadow-xs">
			<div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-description">
				<span aria-hidden="true" className="codicon codicon-clock text-[12px]" />
				<span>{queueSummary(items)}</span>
			</div>
			<div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{items.map((item) => {
					const attachments = attachmentLabel(item.attachmentCount)
					const isSteer = item.delivery === "steer"
					const isCancelling = cancellingIds.has(item.id)
					const isMutating = mutatingIds.has(item.id)
					const isEditing = editingId === item.id
					const isDragging = draggingId === item.id
					const isOver = overId === item.id
					// The prompt text renders in spans whose line boxes are 5 spacing units tall
					// (the global `span { @apply leading-5 }` base style), so every control in the
					// row is sized/offset against that same 5-unit first line to stay vertically
					// centered with it: the dot ((5 - 1.5) / 2 units), the h-5 badges, and the
					// size-5 (26px) icon buttons pulled in by -my-1.5 ((5u - size-5) / 2).
					return (
						<div
							className={`flex items-start gap-1.5 rounded-[3px] bg-input-background/40 px-2 py-1.5 text-xs ${
								isDragging ? "opacity-40" : ""
							} ${isOver ? "bg-input-background ring-1 ring-inset ring-editor-foreground/40" : ""} ${
								isEditing ? "cursor-default" : "cursor-grab active:cursor-grabbing"
							}`}
							draggable={!isEditing && !isMutating && !isCancelling}
							key={item.id}
							onDragEnd={() => {
								setDraggingId(null)
								setOverId(null)
							}}
							onDragLeave={() => {
								if (overId === item.id) {
									setOverId(null)
								}
							}}
							onDragOver={(event) => {
								event.preventDefault()
								event.dataTransfer.dropEffect = "move"
								if (overId !== item.id) {
									setOverId(item.id)
								}
							}}
							onDragStart={(event) => {
								setDraggingId(item.id)
								event.dataTransfer.effectAllowed = "move"
								event.dataTransfer.setData("text/plain", item.id)
							}}
							onDrop={(event) => {
								event.preventDefault()
								void handleDrop(item.id)
							}}>
							<span
								aria-hidden="true"
								className="codicon codicon-gripper mt-1.75 shrink-0 select-none text-description/50"
								title="Drag to reorder"
							/>
							<span aria-hidden="true" className="mt-1.75 size-1.5 shrink-0 rounded-full bg-description/70" />
							{isEditing ? (
								<input
									autoFocus
									className="min-w-0 flex-1 rounded-[3px] border border-editor-foreground/40 bg-input-background px-1.5 py-0.5 text-foreground outline-none"
									onBlur={() => {
										if (editingId === item.id) {
											void saveEdit(item)
										}
									}}
									onChange={(event) => setEditValue(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											void saveEdit(item)
										} else if (event.key === "Escape") {
											setEditingId(null)
										}
									}}
									value={editValue}
								/>
							) : (
								<span className="min-w-0 flex-1 break-words text-foreground" title={item.prompt}>
									{truncatePrompt(item.prompt)}
								</span>
							)}
							{isSteer && (
								<span className="flex h-5 shrink-0 items-center rounded-[3px] border border-editor-group-border px-1.5 text-[10px] leading-none text-description">
									Steer
								</span>
							)}
							{attachments && (
								<span className="flex h-5 shrink-0 items-center rounded-[3px] border border-editor-group-border px-1.5 text-[10px] leading-none text-description">
									{attachments}
								</span>
							)}
							{isMutating || isCancelling ? (
								<span
									aria-hidden="true"
									className="codicon codicon-loading codicon-modifier-animated -my-1.5 size-5 shrink-0 text-description"
								/>
							) : isEditing ? (
								<>
									<button
										aria-label="Save queued message"
										className="-my-1.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground"
										onClick={() => void saveEdit(item)}
										title="Save"
										type="button">
										<span aria-hidden="true" className="codicon codicon-check text-[12px]" />
									</button>
									<button
										aria-label="Cancel edit"
										className="-my-1.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground"
										onClick={() => setEditingId(null)}
										title="Cancel edit"
										type="button">
										<span aria-hidden="true" className="codicon codicon-close text-[12px]" />
									</button>
								</>
							) : (
								<>
									<button
										aria-label="Edit queued message"
										className="-my-1.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground"
										onClick={() => startEdit(item)}
										title="Edit queued message"
										type="button">
										<span aria-hidden="true" className="codicon codicon-edit text-[12px]" />
									</button>
									<button
										aria-label="Cancel queued message"
										className="-my-1.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground"
										onClick={() => cancelQueuedPrompt(item.id)}
										title="Cancel queued message"
										type="button">
										<span aria-hidden="true" className="codicon codicon-close text-[12px]" />
									</button>
								</>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
