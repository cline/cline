import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useClineAuth } from "@/context/ClineAuthContext"
import { TaskServiceClient } from "@/services/grpc-client"

interface EntitlementErrorProps {
	/** Human-readable error message from the backend, if any */
	message?: string
}

// Fall back to production when the authenticated user's app base URL is unavailable.
const DEFAULT_APP_BASE_URL = "https://app.cline.bot"
const CLINE_PASS_SUBSCRIBE_PATH = "/dashboard/subscription"

const DEFAULT_MESSAGE = "This model requires a Cline Pass subscription."

const EntitlementError: React.FC<EntitlementErrorProps> = ({ message }) => {
	const { clineUser } = useClineAuth()
	const displayMessage = message || DEFAULT_MESSAGE
	// Use the environment-aware app base URL (e.g. staging-app.cline.bot on staging)
	// so the subscribe link points at the same environment the user is signed into.
	const appBaseUrl = clineUser?.appBaseUrl || DEFAULT_APP_BASE_URL
	const subscribeUrl = `${appBaseUrl}${CLINE_PASS_SUBSCRIBE_PATH}`

	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)">
			<div className="mb-3">
				<div className="text-error mb-2">{displayMessage}</div>
				<div className="text-(--vscode-descriptionForeground) text-xs">
					Subscribe to Cline Pass to use this model, then retry your request.
				</div>
			</div>

			<VSCodeButtonLink className="w-full mb-2" href={subscribeUrl}>
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
