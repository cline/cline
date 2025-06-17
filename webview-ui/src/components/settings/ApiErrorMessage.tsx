import React from "react"

interface ApiErrorMessageProps {
	errorMessage: string | undefined
	children?: React.ReactNode
}

export const ApiErrorMessage = ({ errorMessage, children }: ApiErrorMessageProps) => (
	<div className="flex flex-col gap-2 text-vscode-errorForeground text-sm" data-testid="api-error-message">
		<div className="flex flex-row items-center gap-1">
			<div className="codicon codicon-close" />
			<div>{errorMessage}</div>
		</div>
		{children}
	</div>
)
