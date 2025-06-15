import React from "react"

/**
 * Props for the ErrorMessage component
 */
interface ErrorMessageProps {
	message: string
	style?: React.CSSProperties
}

/**
 * A reusable component for displaying error messages
 */
export const ErrorMessage = ({ message, style }: ErrorMessageProps) => {
	return (
		<p
			style={{
				margin: "-10px 0 4px 0",
				fontSize: 12,
				color: "var(--vscode-errorForeground)",
				...style,
			}}>
			{message}
		</p>
	)
}
