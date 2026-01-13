import { ClineMessage } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { useClineAuth, useClineSignIn } from "@/context/ClineAuthContext"
import { ClineError, ClineErrorType } from "../../../../src/services/error/ClineError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: ClineMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { clineUser } = useClineAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, handleSignIn } = useClineSignIn()

	/**
	 * Extract a reasonable message from a raw provider error.
	 * This is intentionally *not* ClineError parsing since most providers have their own shapes.
	 */
	const getNativeProviderErrorMessage = (raw: string): { message: string; providerId?: string; code?: string } => {
		if (!raw) {
			return { message: "" }
		}

		// Try JSON parse: many providers send serialized error objects
		try {
			const obj: any = JSON.parse(raw)
			const providerId = obj?.providerId || obj?._error?.providerId
			const code = obj?.code || obj?._error?.code || obj?.error?.code || obj?.error?.type || obj?.type || obj?.name

			const msg =
				obj?.message ||
				obj?.error?.message ||
				obj?.error?.error?.message ||
				obj?.response?.data?.error?.message ||
				obj?.response?.data?.message ||
				raw

			return { message: typeof msg === "string" ? msg : raw, providerId, code: typeof code === "string" ? code : undefined }
		} catch {
			// Not JSON, treat as plain string
			return { message: raw }
		}
	}

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with provider-aware parsing
				if (rawApiError) {
					// Determine provider FIRST (from message.modelInfo if available, otherwise by best-effort parsing)
					const providerIdFromMessage = message.modelInfo?.providerId
					const native = getNativeProviderErrorMessage(rawApiError)
					const providerId = providerIdFromMessage || native.providerId
					const isClineProvider = providerId === "cline"

					if (isClineProvider) {
						// Only Cline provider errors should be parsed as ClineError
						const clineError = ClineError.parse(rawApiError)
						const errorMessage = clineError?._error?.message || clineError?.message || rawApiError
						const requestId = clineError?._error?.request_id
						const errorCode = clineError?._error?.code

						if (clineError?.isErrorType(ClineErrorType.Balance)) {
							const errorDetails = clineError._error?.details
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

						if (clineError?.isErrorType(ClineErrorType.RateLimit)) {
							return (
								<p className="m-0 whitespace-pre-wrap text-(--vscode-errorForeground) wrap-anywhere">
									{errorMessage}
									{requestId && <div>Request ID: {requestId}</div>}
								</p>
							)
						}

						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
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

								{/* Display Login button for non-logged in users using the Cline provider */}
								<div>
									{!clineUser ? (
										<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
											Sign in to Cline
											{isLoginLoading && (
												<span className="ml-1 animate-spin">
													<span className="codicon codicon-refresh"></span>
												</span>
											)}
										</VSCodeButton>
									) : (
										<span className="mb-4 text-description">(Click "Retry" below)</span>
									)}
								</div>
							</p>
						)
					}

					// Non-Cline providers: render their native error message (no ClineError parsing)
					const errorMessage = native.message || rawApiError
					const errorCode = native.code
					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode} </span>}
								{errorMessage}
							</header>
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
							{/* If we extracted a message from JSON, allow users to expand the raw error too */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}
							<div>
								<span className="mb-4 text-description">(Click "Retry" below)</span>
							</div>
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 whitespace-pre-wrap text-(--vscode-errorForeground) wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-(--vscode-textBlockQuote-background) text-(--vscode-foreground)">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "clineignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs bg-(--vscode-textBlockQuote-background) text-(--vscode-foreground) opacity-80">
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
