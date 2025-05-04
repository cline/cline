import React from "react"

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
	isFocused?: boolean // Add optional prop for focus state
}

const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss, isFocused }) => {
	// Removed useEffect logging as per previous step if applicable, or keep if needed.
	// console.log("[QuotedMessagePreview] Rendering with text:", text);

	const cardClassName = `reply-card ${isFocused ? "reply-card--focused" : ""}`

	return (
		// <!-- reply-card BEGIN -->
		<div className={cardClassName} aria-label="Reply context">
			<div className="reply-card__header">
				<span>Replying to</span>
				<button
					className="reply-card__close"
					aria-label="Cancel reply"
					onClick={onDismiss} // Use the passed onDismiss prop directly
				>
					×
				</button>
			</div>

			{/* Put the user’s selection here */}
			<pre className="reply-card__snippet">
				<code>{text}</code> {/* Populate dynamically with truncated text */}
			</pre>
		</div>
		// <!-- reply-card END -->
	)
}

export default QuotedMessagePreview
