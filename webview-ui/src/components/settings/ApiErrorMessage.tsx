import React from "react"

interface ApiErrorMessageProps {
	errorMessage: string | undefined
	children?: React.ReactNode
}
const ApiErrorMessage = ({ errorMessage, children }: ApiErrorMessageProps) => {
	return (
		<div className="text-vscode-errorForeground text-sm">
			<span style={{ fontSize: "2em" }} className={`codicon codicon-close align-middle mr-1`} />
			{errorMessage}
			{children}
		</div>
	)
}
export default ApiErrorMessage
