import { memo } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ClineMessage } from "@shared/ExtensionMessage"
import { ClineError, ClineErrorType } from "../../../../src/services/error/ClineError"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { useClineAuth } from "@/context/ClineAuthContext"

const errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: ClineMessage
	errorType: "error" | "mistake_limit_reached" | "auto_approval_max_req_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { handleSignIn, clineUser } = useClineAuth()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
			case "auto_approval_max_req_reached":
				// Handle API request errors with special error parsing
				if (apiRequestFailedMessage || apiReqStreamingFailedMessage) {
					const clineError = ClineError.parse(apiRequestFailedMessage || apiReqStreamingFailedMessage)
					const clineErrorMessage = clineError?.message
					const requestId = clineError?._error?.request_id
					const isClineProvider = clineError?.providerId === "cline"

					if (clineError) {
						if (clineError.isErrorType(ClineErrorType.Balance)) {
							const errorDetails = clineError._error?.details
							return (
								<CreditLimitError
									currentBalance={errorDetails?.current_balance}
									totalSpent={errorDetails?.total_spent}
									totalPromotions={errorDetails?.total_promotions}
									message={errorDetails?.message}
									buyCreditsUrl={errorDetails?.buy_credits_url}
								/>
							)
						}
					}

					if (clineError?.isErrorType(ClineErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-[var(--vscode-errorForeground)] wrap-anywhere">
								{clineErrorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					// Default error display
					return (
						<p className="m-0 whitespace-pre-wrap text-[var(--vscode-errorForeground)] wrap-anywhere">
							{clineErrorMessage}
							{requestId && <div>Request ID: {requestId}</div>}
							{clineErrorMessage?.toLowerCase()?.includes("powershell") && (
								<>
									<br />
									<br />
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a
										href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
										className="underline text-inherit">
										troubleshooting guide
									</a>
									.
								</>
							)}
							{clineError?.isErrorType(ClineErrorType.Auth) && (
								<>
									<br />
									<br />
									{/* The user is signed in or not using cline provider */}
									{clineUser && !isClineProvider ? (
										<span className="mb-4 text-[var(--vscode-descriptionForeground)]">
											(Click "Retry" below)
										</span>
									) : (
										<VSCodeButton onClick={handleSignIn} className="w-full mb-4">
											Sign in to Cline
										</VSCodeButton>
									)}
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

			case "clineignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs bg-[var(--vscode-textBlockQuote-background)] text-[var(--vscode-foreground)] opacity-80">
						<div>
							Cline tried to access <code>{message.text}</code> which is blocked by the <code>.clineignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and clineignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "clineignore_error") {
		return <>{renderErrorContent()}</>
	}

	// For other error types, show header + content
	return <>{renderErrorContent()}</>
})

export default ErrorRow
