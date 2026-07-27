interface ClineFreeModelLimitErrorProps {
	message: string
}

const FREE_MODEL_LIMIT_RETRY_MARKER = "try again in "

function extractFreeModelLimitResetTime(message: string): string | undefined {
	const backendMessage = message.toLowerCase()
	const resetStart = backendMessage.indexOf(FREE_MODEL_LIMIT_RETRY_MARKER)
	if (resetStart === -1) {
		return undefined
	}

	const resetTime = backendMessage.slice(resetStart + FREE_MODEL_LIMIT_RETRY_MARKER.length).trim()
	return resetTime || undefined
}

const ClineFreeModelLimitError = ({ message }: ClineFreeModelLimitErrorProps) => {
	const resetTime = extractFreeModelLimitResetTime(message)

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-model-limit-error">
			<div className="text-error mb-2">Daily free model limit reached</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				You've reached today's free usage limit for this model.
			</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				{resetTime ? `Try again in ${resetTime}` : "Try again later"} or select another model.
			</div>
		</div>
	)
}

export default ClineFreeModelLimitError
