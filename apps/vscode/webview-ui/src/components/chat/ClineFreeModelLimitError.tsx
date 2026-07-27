interface ClineFreeModelLimitErrorProps {
	message: string
}

const ClineFreeModelLimitError = ({ message }: ClineFreeModelLimitErrorProps) => {
	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-free-model-limit-error">
			<div className="text-error mb-2">Daily free model limit reached</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">{message}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				Wait for the limit to reset, select another model, or select the paid version of this model and retry.
			</div>
		</div>
	)
}

export default ClineFreeModelLimitError
