import React from "react"
import { Clock, X, Send } from "lucide-react"
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

	const formatMessagePreview = (message: QueuedMessage) => {
		const hasText = message.text.trim().length > 0
		const hasImages = message.images.length > 0
		const hasFiles = message.files.length > 0
		
		if (hasText) {
			return message.text.length > 80 ? `${message.text.slice(0, 80)}...` : message.text
		}
		
		if (hasImages || hasFiles) {
			const parts = []
			if (hasImages) parts.push(`${message.images.length} image${message.images.length !== 1 ? 's' : ''}`)
			if (hasFiles) parts.push(`${message.files.length} file${message.files.length !== 1 ? 's' : ''}`)
			return parts.join(', ')
		}
		
		return 'Empty message'
	}

	return (
		<div className="bg-[var(--vscode-notifications-background)] border-l-4 border-l-[var(--vscode-notificationsInfoIcon-foreground)] shadow-sm">
			<div className="flex items-center justify-between p-3 border-b border-[var(--vscode-notifications-border)]">
				<div className="flex items-center text-[var(--vscode-notifications-foreground)] text-sm font-medium">
					<Clock size={16} className="mr-2 text-[var(--vscode-notificationsInfoIcon-foreground)]" />
					<span>{queuedMessages.length} message{queuedMessages.length > 1 ? 's' : ''} queued</span>
					<Send size={14} className="ml-2 text-[var(--vscode-descriptionForeground)]" />
				</div>
				<button 
					onClick={onClearAll}
					className="text-[var(--vscode-notifications-foreground)] hover:text-[var(--vscode-errorForeground)] text-xs px-2 py-1 rounded border border-[var(--vscode-notifications-border)] hover:border-[var(--vscode-errorForeground)] transition-colors"
					title="Clear all queued messages"
				>
					Clear all
				</button>
			</div>
			<div className="max-h-32 overflow-y-auto">
				{queuedMessages.map((message, index) => (
					<div key={message.id} className="flex items-start justify-between px-3 py-2 border-b border-[var(--vscode-notifications-border)] last:border-b-0 hover:bg-[var(--vscode-list-hoverBackground)]">
						<div className="flex items-start flex-1 min-w-0">
							<div className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] text-xs flex items-center justify-center mr-2 mt-0.5">
								{index + 1}
							</div>
							<div className="flex-1 text-sm text-[var(--vscode-notifications-foreground)] leading-relaxed">
								{formatMessagePreview(message)}
								{message.images.length > 0 && (
									<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
										📷 {message.images.length} image{message.images.length !== 1 ? 's' : ''}
									</div>
								)}
								{message.files.length > 0 && (
									<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
										📎 {message.files.length} file{message.files.length !== 1 ? 's' : ''}
									</div>
								)}
							</div>
						</div>
						<button
							onClick={() => onRemove(message.id)}
							className="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)] ml-3 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors flex-shrink-0"
							title="Remove from queue"
						>
							<X size={14} />
						</button>
					</div>
				))}
			</div>
			<div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)] border-t border-[var(--vscode-notifications-border)] bg-[var(--vscode-notifications-background)]">
				💡 Messages will be sent automatically when Cline becomes available
			</div>
		</div>
	)
}