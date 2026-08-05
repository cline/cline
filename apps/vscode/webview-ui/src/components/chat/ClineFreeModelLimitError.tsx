import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useSwitchToPaidClineModel } from "@/hooks/useSwitchToPaidClineModel"
import { extractClineFreeModelLimitResetTime } from "../../../../src/services/error/ClineError"

interface ClineFreeModelLimitErrorProps {
	message: string
	/** The cline-free/<slug> model selected for the current mode. */
	modelId?: string
}

const ClineFreeModelLimitError = ({ message, modelId }: ClineFreeModelLimitErrorProps) => {
	const { paidModelId, isSwitching, didSwitch, switchError, switchToPaidModel } = useSwitchToPaidClineModel(modelId)

	const resetTime = extractClineFreeModelLimitResetTime(message)

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
			{paidModelId && (
				<>
					<div className="text-(--vscode-descriptionForeground) text-xs mt-2 wrap-anywhere">
						Or switch to the paid version of this model ({paidModelId}) with usage-based billing.
					</div>
					<VSCodeButton
						appearance="primary"
						className="w-full mt-3"
						disabled={isSwitching || didSwitch}
						onClick={switchToPaidModel}>
						{isSwitching ? "Switching..." : didSwitch ? "Switched to Usage-Based billing" : "Switch to Usage-Based billing"}
					</VSCodeButton>
					{didSwitch && (
						<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
							Retry the request after switching.
						</div>
					)}
					{switchError && <div className="text-error text-xs mt-2">{switchError}</div>}
				</>
			)}
		</div>
	)
}

export default ClineFreeModelLimitError
