import { BeadsmithMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { Button } from "@/components/ui/button"
import { useBeadsmithAuth, useBeadsmithSignIn } from "@/context/BeadsmithAuthContext"
import { BeadsmithError, BeadsmithErrorType } from "../../../../src/services/error/BeadsmithError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: BeadsmithMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "beadsmithignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { beadsmithUser } = useBeadsmithAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, handleSignIn } = useBeadsmithSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: BeadsmithError parsing should not be applied to non-Cline providers, but it seems we're using beadsmithErrorMessage below in the default error display
					const beadsmithError = BeadsmithError.parse(rawApiError)
					const errorMessage = beadsmithError?._error?.message || beadsmithError?.message || rawApiError
					const requestId = beadsmithError?._error?.request_id
					const providerId = beadsmithError?.providerId || beadsmithError?._error?.providerId
					const isBeadsmithProvider = providerId === "cline"
					const errorCode = beadsmithError?._error?.code

					if (beadsmithError?.isErrorType(BeadsmithErrorType.Balance)) {
						const errorDetails = beadsmithError._error?.details
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

					if (beadsmithError?.isErrorType(BeadsmithErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the BeadsmithError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a
										className="underline text-inherit"
										href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22">
										troubleshooting guide
									</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}

							{/* Display Login button for non-logged in users using the Beadsmith provider */}
							<div>
								{/* The user is signed in or not using cline provider */}
								{isBeadsmithProvider && !beadsmithUser ? (
									<Button className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
										Sign in to Beadsmith
										{isLoginLoading && (
											<span className="ml-1 animate-spin">
												<span className="codicon codicon-refresh"></span>
											</span>
										)}
									</Button>
								) : (
									<span className="mb-4 text-description">(Click "Retry" below)</span>
								)}
							</div>
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "beadsmithignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							Beadsmith tried to access <code>{message.text}</code> which is blocked by the <code>.beadsmithignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and beadsmithignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "beadsmithignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
