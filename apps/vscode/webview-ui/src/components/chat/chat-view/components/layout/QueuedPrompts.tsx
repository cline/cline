import type { QueuedPrompt } from "@shared/ExtensionMessage"

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

interface QueuedPromptsProps {
	items?: QueuedPrompt[]
}

export function QueuedPrompts({ items = [] }: QueuedPromptsProps) {
	if (items.length === 0) {
		return null
	}

	return (
		<div className="mx-3 mb-2 rounded-xs border border-editor-group-border bg-code px-2 py-1.5">
			<div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-description">
				<span className="codicon codicon-clock text-[12px]" />
				<span>{items.length === 1 ? "Queued message" : `${items.length} queued messages`}</span>
			</div>
			<div className="flex max-h-24 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{items.map((item) => {
					const attachments = attachmentLabel(item.attachmentCount)
					return (
						<div className="flex items-start gap-1.5 text-xs leading-snug" key={item.id}>
							<span className="codicon codicon-chevron-right mt-[1px] shrink-0 text-[11px] text-description" />
							<span className="min-w-0 flex-1 break-words text-foreground">{truncatePrompt(item.prompt)}</span>
							{attachments && <span className="shrink-0 text-description">{attachments}</span>}
						</div>
					)
				})}
			</div>
		</div>
	)
}
