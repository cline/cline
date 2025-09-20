import React from "react"
import { Clock, X } from "lucide-react"
import type { QueuedMessage } from "./chat-view/types/chatTypes"

interface QueuedMessagesIndicatorProps {
	queuedMessages: QueuedMessage[]
	onRemove: (id: string) => void
	onClearAll: () => void
}

export const QueuedMessagesIndicator: React.FC<QueuedMessagesIndicatorProps> = ({
	queuedMessages,
	onRemove,
	onClearAll,
}) => {
	if (queuedMessages.length === 0) {
		return null
	}

	return (
		<div className="bg-[var(--vscode-badge-background)] border border-[var(--vscode-badge-foreground)] rounded-md p-3 m-2">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center text-[var(--vscode-badge-foreground)] text-sm">
					<Clock size={14} className="mr-1" />
					<span>{queuedMessages.length} message{queuedMessages.length > 1 ? 's' : ''} queued</span>
				</div>
				<button 
					onClick={onClearAll}
					className="text-[var(--vscode-badge-foreground)] hover:text-[var(--vscode-errorForeground)] text-xs underline"
				>
					Clear all
				</button>
			</div>
			<div className="space-y-1">
				{queuedMessages.map((message) => (
					<div key={message.id} className="flex items-start justify-between bg-[var(--vscode-editor-background)] rounded px-2 py-1">
						<div className="flex-1 text-sm text-[var(--vscode-editor-foreground)] truncate">
							{message.text || (message.images.length > 0 || message.files.length > 0 ? 
								`${message.images.length} image${message.images.length !== 1 ? 's' : ''}, ${message.files.length} file${message.files.length !== 1 ? 's' : ''}` : 
								'Empty message')}
						</div>
						<button
							onClick={() => onRemove(message.id)}
							className="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)] ml-2"
							title="Remove from queue"
						>
							<X size={12} />
						</button>
					</div>
				))}
			</div>
		</div>
	)
}