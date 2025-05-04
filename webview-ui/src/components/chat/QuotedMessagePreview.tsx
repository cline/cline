import React from "react"

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
	isFocused?: boolean
}

const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss, isFocused }) => {
	const cardClassName = `reply-card ${isFocused ? "reply-card--focused" : ""}`

	return (
		<div className={cardClassName} aria-label="Reply context">
			<div className="reply-card__header">
				<span>Replying to</span>
				<button className="reply-card__close" aria-label="Cancel reply" onClick={onDismiss}>
					×
				</button>
			</div>

			<pre className="reply-card__snippet">
				<code>{text}</code>
			</pre>
		</div>
	)
}

export default QuotedMessagePreview
