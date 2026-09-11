import type { ClineMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import { Trans, useTranslation } from "react-i18next"
import { ClineAuthStatus } from "@/components/account/ClineAuthStatus"
import ClineFreeModelLimitError from "@/components/chat/ClineFreeModelLimitError"
import ClineFreePromotionEndedError from "@/components/chat/ClineFreePromotionEndedError"
import ClinePassLimitError from "@/components/chat/ClinePassLimitError"
import CreditLimitError from "@/components/chat/CreditLimitError"
import EntitlementError from "@/components/chat/EntitlementError"
import OrgClinePassRestrictionError from "@/components/chat/OrgClinePassRestrictionError"
import SpendLimitError from "@/components/chat/SpendLimitError"
import { Button } from "@/components/ui/button"
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
	const { t } = useTranslation()
	const { clineUser } = useClineAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: ClineError parsing should not be applied to non-Cline providers, but it seems we're using clineErrorMessage below in the default error display
					const clineError = ClineError.parse(rawApiError)
					const errorMessage = clineError?._error?.message || clineError?.message || rawApiError
					const requestId = clineError?._error?.request_id
					const providerId = clineError?.providerId || clineError?._error?.providerId
					// Deliberately narrower than the shared isClineManagedProvider (which
					// also matches cline-pass): only usage-billing errors get the credit
					// and login prompts below.
					const isClineUsageBillingProvider = providerId === "cline"
					const errorCode = clineError?._error?.code

					if (clineError?.isErrorType(ClineErrorType.Balance)) {
						const errorDetails = clineError._error?.details
						if (isClineUsageBillingProvider || errorDetails?.buy_credits_url) {
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

					if (clineError?.isErrorType(ClineErrorType.SpendLimit)) {
						const d = clineError._error?.details
						return (
							<SpendLimitError
								budgetPeriod={d?.budget_period}
								limitUsd={d?.limit_usd}
								message={d?.message || errorMessage}
								resetsAt={d?.resets_at}
								spentUsd={d?.spent_usd}
							/>
						)
					}

					if (clineError?.isErrorType(ClineErrorType.Entitlement)) {
						const detailMessage = clineError?._error?.details?.message || errorMessage
						return <EntitlementError message={detailMessage} />
					}

					if (clineError?.isErrorType(ClineErrorType.OrgClinePassRestriction)) {
						return <OrgClinePassRestrictionError />
					}

					if (clineError?.isErrorType(ClineErrorType.ClinePassLimit)) {
						const detailMessage = clineError?._error?.details?.message || errorMessage
						return <ClinePassLimitError message={detailMessage} />
					}

					if (clineError?.isErrorType(ClineErrorType.ClineFreeModelLimit)) {
						const detailMessage = clineError?._error?.details?.message || errorMessage
						return <ClineFreeModelLimitError message={detailMessage} />
					}

					// A retired free model answers model-not-found once its promotion
					// ends — dedicated copy plus a route into the model picker,
					// since retrying the deleted model can never succeed.
					if (clineError?.isErrorType(ClineErrorType.ClineFreePromotionEnded)) {
						return <ClineFreePromotionEndedError />
					}

					if (clineError?.isErrorType(ClineErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>{t("chat:errors.requestId", { requestId })}</div>}
							</p>
						)
					}

					if (clineError?.isErrorType(ClineErrorType.QuotaExceeded)) {
						const detailMessage = clineError?._error?.details?.message || errorMessage
						return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{detailMessage}</p>
					}

					if (clineError?.isErrorType(ClineErrorType.Auth) && isClineUsageBillingProvider) {
						return !clineUser ? (
							// User is using Cline provider and is not logged in
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-center rounded border border-neutral-500/30 bg-vscode-editor-background p-6 text-center text-vscode-foreground">
									{t("chat:errors.auth.loggedOut")}
								</div>
								<Button className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
									{t("chat:errors.auth.signIn")}
									{isLoginLoading && (
										<span className="ml-1 animate-spin">
											<span className="codicon codicon-refresh" />
										</span>
									)}
								</Button>
								<ClineAuthStatus message={authStatusMessage} />
							</div>
						) : (
							// Don't show sign in button after the user has logged in, just ask them to retry
							<div className="mt-4">
								<span className="text-description">{t("chat:errors.auth.clickRetryBelow")}</span>
							</div>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the ClineError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>{t("chat:errors.requestId", { requestId })}</div>}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									<Trans
										components={{
											helpLink: (
												<a
													className="underline text-inherit"
													href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
												/>
											),
										}}
										i18nKey="chat:errors.powershellHelp"
									/>
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>{t("chat:errors.diffError")}</div>
					</div>
				)

			case "clineignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							<Trans
								components={{ fileCode: <code />, path: <code /> }}
								i18nKey="chat:errors.clineignore"
								values={{ path: message.text }}
							/>
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and clineignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "clineignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
