import { AiHydroMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { AiHydroError, AiHydroErrorType } from "../../../../src/services/error/AiHydroError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: AiHydroMessage
	errorType: "error" | "mistake_limit_reached" | "auto_approval_max_req_reached" | "diff_error" | "aihydroignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
			case "auto_approval_max_req_reached":
				// Handle API request errors with special error parsing
				if (apiRequestFailedMessage || apiReqStreamingFailedMessage) {
					// FIXME: AiHydroError parsing should not be applied to non-AI-Hydro providers, but it seems we're using parsedErrorMessage below in the default error display
					const parsedError = AiHydroError.parse(apiRequestFailedMessage || apiReqStreamingFailedMessage)
					const parsedErrorMessage = parsedError?.message
					const requestId = parsedError?._error?.request_id
					const isAiHydroProvider = parsedError?.providerId === "aihydro"

					if (parsedError) {
						if (parsedError.isErrorType(AiHydroErrorType.Balance)) {
							const errorDetails = parsedError._error?.details
							return (
								<CreditLimitError
									buyCreditsUrl={errorDetails?.buy_credits_url}
									currentBalance={errorDetails?.current_balance}
									message={errorDetails?.message}
									totalPromotions={errorDetails?.total_promotions}
									totalSpent={errorDetails?.total_spent}
								/>
							)
						}
					}

					if (parsedError?.isErrorType(AiHydroErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-[var(--vscode-errorForeground)] wrap-anywhere">
								{parsedErrorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					// For non-AI-Hydro providers, we display the raw error message
					const errorMessageToDisplay = isAiHydroProvider
						? parsedErrorMessage
						: apiReqStreamingFailedMessage || apiRequestFailedMessage

					// Default error display
					return (
						<p className="m-0 whitespace-pre-wrap text-[var(--vscode-errorForeground)] wrap-anywhere">
							{errorMessageToDisplay}
							{requestId && <div>Request ID: {requestId}</div>}
							{parsedErrorMessage?.toLowerCase()?.includes("powershell") && (
								<>
									<br />
									<br />
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a className="underline text-inherit" href="https://github.com/AI-Hydro/AI-Hydro/issues">
										troubleshooting guide
									</a>
									.
								</>
							)}
							{parsedError?.isErrorType(AiHydroErrorType.Auth) && (
								<>
									<br />
									<br />
									<span className="mb-4 text-[var(--vscode-descriptionForeground)]">
										Check your provider credentials, then click Retry.
									</span>
								</>
							)}
						</p>
					)
				}

				// Regular error message
				return (
					<p className="m-0 whitespace-pre-wrap text-[var(--vscode-errorForeground)] wrap-anywhere">{message.text}</p>
				)

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-[var(--vscode-textBlockQuote-background)] text-[var(--vscode-foreground)]">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "aihydroignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs bg-[var(--vscode-textBlockQuote-background)] text-[var(--vscode-foreground)] opacity-80">
						<div>
							AI-Hydro tried to access <code>{message.text}</code> which is blocked by the{" "}
							<code>.aihydroignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and aihydroignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "aihydroignore_error") {
		return <>{renderErrorContent()}</>
	}

	// For other error types, show header + content with error accent card
	return <div className="error-message-card">{renderErrorContent()}</div>
})

export default ErrorRow
