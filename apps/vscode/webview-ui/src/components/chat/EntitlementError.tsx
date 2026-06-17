import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { getAppBaseUrl } from "@/constants"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

interface EntitlementErrorProps {
	/** Human-readable error message from the backend, if any */
	message?: string
}

const CLINE_PASS_SUBSCRIBE_PATH = "/dashboard/subscription"

const HEADLINE = "This model requires a Cline Pass subscription."

const EntitlementError: React.FC<EntitlementErrorProps> = ({ message }) => {
	const { clineUser } = useClineAuth()
	const { environment } = useExtensionState()
	// Point the subscribe link at the same environment the user is signed into.
	// Prefer the authenticated user's app base URL, then the current environment, then production.
	const appBaseUrl = clineUser?.appBaseUrl || getAppBaseUrl(environment)
	const subscribeUrl = new URL(CLINE_PASS_SUBSCRIBE_PATH, appBaseUrl).toString()
	// Show friendly product copy as the headline; surface the backend detail (if any)
	// in a muted line for support/debugging rather than as the primary message.
	const backendDetail = message && message !== HEADLINE ? message : undefined

	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)">
			<div className="mb-3">
				<div className="text-error mb-2">{HEADLINE}</div>
				<div className="text-(--vscode-descriptionForeground) text-xs">
					Subscribe to Cline Pass to use this model, then retry your request.
				</div>
				{backendDetail && (
					<div className="text-(--vscode-descriptionForeground) text-xs mt-1 opacity-80 wrap-anywhere">
						{backendDetail}
					</div>
				)}
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
