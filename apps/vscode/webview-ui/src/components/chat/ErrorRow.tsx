import type { ClineMessage, ClineSayAutoRecovery } from "@shared/ExtensionMessage"
import { RefreshCw } from "lucide-react"
import { memo, type ReactNode, useEffect, useRef, useState } from "react"
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

/**
 * Shared error presentation block: dark red background, grey text, grey
 * border, and a full-height glyph anchored to the right edge of the block
 * (~12% of its width). Defaults to the exclamation-in-circle glyph; recovery
 * countdown rows override it with a live countdown ring.
 */
export const ErrorBlock = ({ children, glyph }: { children: ReactNode; glyph?: ReactNode }) => (
	<div className="my-1 flex items-stretch gap-3 rounded-md border border-zinc-500 bg-[#7f1d1d] p-3">
		<div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300 wrap-anywhere">{children}</div>
		<div className="flex w-[12%] max-w-11 shrink-0 items-center justify-center">
			{glyph ?? (
				<svg
					aria-hidden="true"
					className="aspect-square h-full max-h-full max-w-full text-zinc-500"
					fill="none"
					viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1.6" />
					<path d="M12 6.6v6.6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
					<circle cx="12" cy="16.9" fill="currentColor" r="1.35" />
				</svg>
			)}
		</div>
	</div>
)

/**
 * Ring radius/circumference for the recovery countdown glyph — identical to
 * the default exclamation glyph's circle geometry so the swap causes no
 * visual shift.
 */
const RING_RADIUS = 10.2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * Live countdown glyph for auto-recovery: seconds remaining inside the
 * circle, the surrounding ring draining away as the retry approaches. Ticks
 * client-side off the scheduled `retryAt` timestamp — no per-second message
 * traffic. The drain is driven by requestAnimationFrame against the wall
 * clock (smooth 60fps, self-correcting if frames are dropped) with the
 * dashoffset written imperatively so the animation never aliases to a timer.
 * Once the countdown passes zero it yields to the retrying spinner.
 */
const CountdownRing = ({ retryAt, delaySeconds }: { retryAt: number; delaySeconds: number }) => {
	const ringRef = useRef<SVGCircleElement>(null)
	const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))

	useEffect(() => {
		const totalMs = Math.max(1, delaySeconds * 1000)
		let frame = 0
		let lastSecond = -1
		const tick = () => {
			const remainingMs = Math.max(0, retryAt - Date.now())
			const drained = Math.min(1, Math.max(0, 1 - remainingMs / totalMs))
			ringRef.current?.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE * drained))
			const second = Math.ceil(remainingMs / 1000)
			if (second !== lastSecond) {
				// Only the seconds label needs a re-render; the ring itself is
				// updated imperatively above, every frame.
				lastSecond = second
				setRemainingSeconds(second)
			}
			if (remainingMs > 0) {
				frame = requestAnimationFrame(tick)
			}
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [retryAt, delaySeconds])

	if (remainingSeconds <= 0) {
		return <RetryingIndicator />
	}

	const totalMs = Math.max(1, delaySeconds * 1000)
	const initialDrained = Math.min(1, Math.max(0, 1 - Math.max(0, retryAt - Date.now()) / totalMs))

	return (
		<svg
			aria-label={`Retrying in ${remainingSeconds} seconds`}
			className="aspect-square h-full max-h-full max-w-full text-zinc-500"
			fill="none"
			viewBox="0 0 24 24">
			<circle className="text-zinc-700" cx="12" cy="12" r={RING_RADIUS} stroke="currentColor" strokeWidth="1.6" />
			<circle
				cx="12"
				cy="12"
				r={RING_RADIUS}
				ref={ringRef}
				stroke="currentColor"
				strokeDasharray={RING_CIRCUMFERENCE}
				strokeDashoffset={RING_CIRCUMFERENCE * initialDrained}
				strokeLinecap="round"
				strokeWidth="1.6"
				transform="rotate(-90 12 12)"
			/>
			<text
				className="fill-current"
				dominantBaseline="central"
				fontSize={remainingSeconds > 99 ? 7.5 : remainingSeconds > 9 ? 8.5 : 10}
				fontWeight={600}
				textAnchor="middle"
				x="12"
				y="12.5">
				{remainingSeconds}
			</text>
		</svg>
	)
}

/**
 * Indeterminate glyph shown while the scheduled retry is streaming. Sized and
 * colored like the exclamation glyph it replaces (fills the glyph slot box).
 * The spin runs on a wrapping HTML span — the same pattern as the sign-in
 * button above — so the rotation is compositor-driven and stays smooth even
 * while the webview re-renders the chat during the retried stream.
 */
const RetryingIndicator = () => (
	<span className="flex aspect-square h-full max-h-full max-w-full animate-spin items-center justify-center text-zinc-500">
		<RefreshCw aria-label="Retrying" className="h-full w-full" />
	</span>
)

/**
 * Glyph override for the error block the active auto-recovery marker
 * decorates: the countdown ring drains toward `retryAt`, then a spinner takes
 * over while the retry streams. Returns undefined for settled/unknown states
 * so the block keeps its default exclamation glyph.
 */
const renderAutoRecoveryGlyph = (recovery: ClineSayAutoRecovery): ReactNode | undefined => {
	if (recovery.status === "countdown" && recovery.retryAt !== undefined) {
		return <CountdownRing delaySeconds={recovery.delaySeconds} retryAt={recovery.retryAt} />
	}
	if (recovery.status === "retrying") {
		return <RetryingIndicator />
	}
	return undefined
}

interface ErrorRowProps {
	message: ClineMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	/** Auto-recovery decoration payload when this block is the streak's decorated error block. */
	recovery?: ClineSayAutoRecovery
}

const ErrorRow = memo(
	({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage, recovery }: ErrorRowProps) => {
		const { clineUser } = useClineAuth()
		const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

		const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()

		// While an auto-recovery streak is counting down / retrying, the block's
		// exclamation glyph swaps for the countdown ring or spinner; the error
		// text below stays frozen.
		const glyph = recovery ? renderAutoRecoveryGlyph(recovery) : undefined

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
								<ErrorBlock glyph={glyph}>
									{errorMessage}
									{requestId && <div>Request ID: {requestId}</div>}
								</ErrorBlock>
							)
						}

						if (clineError?.isErrorType(ClineErrorType.QuotaExceeded)) {
							const detailMessage = clineError?._error?.details?.message || errorMessage
							return <ErrorBlock glyph={glyph}>{detailMessage}</ErrorBlock>
						}

						if (clineError?.isErrorType(ClineErrorType.Auth) && isClineUsageBillingProvider) {
							return !clineUser ? (
								// User is using Cline provider and is not logged in
								<div className="flex flex-col gap-3">
									<div className="flex items-center justify-center rounded border border-neutral-500/30 bg-vscode-editor-background p-6 text-center text-vscode-foreground">
										Whoops looks like you're logged out – click below to sign in
									</div>
									<Button className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
										Sign in to Cline
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
									<span className="text-description">(Click "Retry" below)</span>
								</div>
							)
						}

						return (
							<ErrorBlock glyph={glyph}>
								<div className="flex flex-col gap-3">
									{/* Display the well-formatted error extracted from the ClineError instance */}

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
								</div>
							</ErrorBlock>
						)
					}

					// Regular error message
					return <ErrorBlock glyph={glyph}>{message.text}</ErrorBlock>

				case "diff_error":
					return (
						<ErrorBlock>The model used search patterns that don't match anything in the file. Retrying...</ErrorBlock>
					)

				case "clineignore_error":
					return (
						<ErrorBlock>
							Cline tried to access <code>{message.text}</code> which is blocked by the <code>.clineignore</code>{" "}
							file.
						</ErrorBlock>
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
	},
)

export default ErrorRow
