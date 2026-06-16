import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { TaskServiceClient } from "@/services/grpc-client"

interface EntitlementErrorProps {
	/** Human-readable error message from the backend, if any */
	message?: string
}

const CLINE_PASS_SUBSCRIBE_URL = "https://app.cline.bot/dashboard/subscription"

const DEFAULT_MESSAGE = "This model requires a Cline Pass subscription."

const EntitlementError: React.FC<EntitlementErrorProps> = ({ message }) => {
	const displayMessage = message || DEFAULT_MESSAGE

	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)">
			<div className="mb-3">
				<div className="text-error mb-2">{displayMessage}</div>
				<div className="text-(--vscode-descriptionForeground) text-xs">
					Subscribe to Cline Pass to use this model, then retry your request.
				</div>
			</div>

			<VSCodeButtonLink className="w-full mb-2" href={CLINE_PASS_SUBSCRIBE_URL}>
				<span className="codicon codicon-rocket mr-[6px] text-[14px]" />
				Get Cline Pass
			</VSCodeButtonLink>

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				onClick={async () => {
					try {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default EntitlementError
