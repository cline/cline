import type { QueuedPrompt } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { useRef, useState } from "react"
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
	/**
	 * Restores a queued prompt back to the input box (double-click). Removes it
	 * from the queue first; the caller is responsible for calling
	 * TaskServiceClient.cancelQueuedPrompt.
	 */
	onEditPrompt?: (prompt: string, id: string) => void
}

export function QueuedPrompts({ items = [], onEditPrompt }: QueuedPromptsProps) {
	const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set())
	const cancelGuardsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

	if (items.length === 0) {
		return null
	}

	const cancelQueuedPrompt = (promptId: string) => {
		// 10s guard: if the RPC hangs (extension host busy), re-enable the cancel
		// button so the user is not stuck with a dead control.
		if (cancelGuardsRef.current.has(promptId)) {
			return
		}
		const guard = setTimeout(() => {
			cancelGuardsRef.current.delete(promptId)
			setCancellingIds((current) => {
				const next = new Set(current)
				next.delete(promptId)
				return next
			})
		}, 10_000)
		cancelGuardsRef.current.set(promptId, guard)
		setCancellingIds((current) => new Set(current).add(promptId))
		TaskServiceClient.cancelQueuedPrompt(StringRequest.create({ value: promptId }))
			.catch((error) => {
				console.error("Failed to cancel queued prompt:", error)
			})
			.finally(() => {
				const activeGuard = cancelGuardsRef.current.get(promptId)
				if (activeGuard) {
					clearTimeout(activeGuard)
					cancelGuardsRef.current.delete(promptId)
				}
				setCancellingIds((current) => {
					const next = new Set(current)
					next.delete(promptId)
					return next
				})
			})
	}

	const handleEditPrompt = (prompt: string, id: string) => {
		if (!onEditPrompt) {
			return
		}
		// Editing = pull the prompt out of the queue and restore it to the input.
		cancelQueuedPrompt(id)
		onEditPrompt(prompt, id)
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
					return (
						<div
							className="group flex items-start gap-2 rounded-[3px] bg-input-background/40 px-2 py-1.5 text-xs leading-snug"
							key={item.id}
							onDoubleClick={() => handleEditPrompt(item.prompt, item.id)}
							title={onEditPrompt ? "Double-click to edit this message" : item.prompt}>
							<span aria-hidden="true" className="mt-[5px] size-1.5 shrink-0 rounded-full bg-description/70" />
							<span className="min-w-0 flex-1 break-words text-foreground" title={item.prompt}>
								{truncatePrompt(item.prompt)}
							</span>
							{isSteer && (
								<span className="shrink-0 rounded-[3px] border border-editor-group-border px-1.5 py-[1px] text-[10px] leading-4 text-description">
									Steer
								</span>
							)}
							{attachments && (
								<span className="shrink-0 rounded-[3px] border border-editor-group-border px-1.5 py-[1px] text-[10px] leading-4 text-description">
									{attachments}
								</span>
							)}
							<button
								aria-label="Cancel queued message"
								className="mt-[-2px] flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
								disabled={isCancelling}
								onClick={() => cancelQueuedPrompt(item.id)}
								title="Cancel queued message"
								type="button">
								<span aria-hidden="true" className="codicon codicon-close text-[12px]" />
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
}
