import React from "react"

interface ScreenReaderAnnounceProps {
	/** The message to announce to screen readers */
	message: string
	/** The politeness level of the announcement (default: "assertive") */
	politeness?: "polite" | "assertive"
}

/**
 * Visually hidden component that announces messages to screen readers.
 * Uses an aria-live region to communicate dynamic content changes.
 */
const ScreenReaderAnnounce: React.FC<ScreenReaderAnnounceProps> = ({ message, politeness = "assertive" }) => {
	return (
		<div
			aria-atomic="true"
			aria-live={politeness}
			style={{
				position: "absolute",
				width: "1px",
				height: "1px",
				padding: 0,
				margin: "-1px",
				overflow: "hidden",
				clip: "rect(0, 0, 0, 0)",
				whiteSpace: "nowrap",
				border: 0,
			}}>
			{message}
		</div>
	)
}

export default ScreenReaderAnnounce
