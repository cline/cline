import { memo, useMemo } from "react"
import CreditLimitError from "./CreditLimitError"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

export const ErrorRow = memo(
	({
		error,
		apiRequestFailedMessage,
		apiReqStreamingFailedMessage,
		clineUser,
		handleSignIn,
		pStyle,
	}: {
		error: any
		apiRequestFailedMessage: string | undefined
		apiReqStreamingFailedMessage: string | undefined
		clineUser: any
		handleSignIn: () => void
		pStyle: React.CSSProperties
	}) => {
		console.error("ErrorRow", { error, apiRequestFailedMessage, apiReqStreamingFailedMessage })
		const errorInfo = useMemo(() => {
			// Parse structured error first
			if (error) {
				console.log("Structured error object found:", error)
				const errorDetails =
					(error.errorDetails?.details?.error as any) ||
					parseErrorText(error.errorDetails?.details?.message || error.message) ||
					error
				const errorMessage = errorDetails?.message || error.message || "An unknown error occurred."

				return {
					details: errorDetails,
					message: errorMessage,
					isStructured: true,
				}
			}

			// Fallback to text parsing
			const errorData = parseErrorText(apiRequestFailedMessage || apiReqStreamingFailedMessage)
			const errorMessage = apiRequestFailedMessage || apiReqStreamingFailedMessage || ""

			return {
				details: errorData,
				message: errorMessage,
				isStructured: false,
			}
		}, [error, apiRequestFailedMessage, apiReqStreamingFailedMessage])

		const isRateLimitError = useMemo(() => {
			const message = errorInfo.message.toLowerCase()
			return (
				errorInfo.details?.status === 429 ||
				message.includes("rate limit") ||
				message.includes("too many requests") ||
				message.includes("quota exceeded") ||
				message.includes("resource exhausted")
			)
		}, [errorInfo])

		const isCreditLimitError = useMemo(() => {
			return errorInfo.details?.code === "insufficient_credits" && typeof errorInfo.details?.current_balance === "number"
		}, [errorInfo.details])

		const isAuthError = useMemo(() => {
			return errorInfo.message.includes("Unauthorized: Please sign in to Cline before trying again.")
		}, [errorInfo.message])

		const isPowerShellError = useMemo(() => {
			return errorInfo.message.toLowerCase().includes("powershell")
		}, [errorInfo.message])

		if (isCreditLimitError) {
			return (
				<CreditLimitError
					currentBalance={errorInfo.details.current_balance}
					totalSpent={errorInfo.details.total_spent}
					totalPromotions={errorInfo.details.total_promotions}
					message={errorInfo.details.message}
					buyCreditsUrl={errorInfo.details.buy_credits_url}
				/>
			)
		}

		return (
			<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>
				{errorInfo.message}
				{isAuthError && (
					<>
						<br />
						<br />
						{clineUser ? (
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>(Click "Retry" below)</span>
						) : (
							<VSCodeButton onClick={handleSignIn} className="w-full mb-4">
								Sign in to Cline
							</VSCodeButton>
						)}
					</>
				)}
				{isPowerShellError && (
					<>
						<br />
						<br />
						It seems like you're having Windows PowerShell issues, please see this{" "}
						<a
							href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
							style={{ color: "inherit", textDecoration: "underline" }}>
							troubleshooting guide
						</a>
						.
					</>
				)}
			</p>
		)
	},
)

function parseErrorText(text: string | undefined) {
	if (!text) {
		return undefined
	}
	try {
		const startIndex = text.indexOf("{")
		const endIndex = text.lastIndexOf("}")
		if (startIndex !== -1 && endIndex !== -1) {
			const jsonStr = text.substring(startIndex, endIndex + 1)
			const errorObject = JSON.parse(jsonStr)
			return errorObject
		}
	} catch (e) {
		// Not JSON or missing required fields
	}
}
