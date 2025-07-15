import { memo, useMemo } from "react"
import CreditLimitError from "./CreditLimitError"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface ErrorInfo {
	details: any
	message: string
	isStructured: boolean
}

interface ErrorRowProps {
	error: any
	apiRequestFailedMessage: string | undefined
	apiReqStreamingFailedMessage: string | undefined
	clineUser: any
	handleSignIn: () => void
	pStyle: React.CSSProperties
}

const parseErrorText = (text: string | undefined): any => {
	if (!text) return undefined

	const startIndex = text.indexOf("{")
	const endIndex = text.lastIndexOf("}")

	if (startIndex === -1 || endIndex === -1) return undefined

	try {
		return JSON.parse(text.substring(startIndex, endIndex + 1))
	} catch {
		return undefined
	}
}

const getErrorInfo = (
	error: any,
	apiRequestFailedMessage: string | undefined,
	apiReqStreamingFailedMessage: string | undefined,
): ErrorInfo => {
	// Handle structured error first
	if (error) {
		const errorDetails =
			error.errorDetails?.details?.error || parseErrorText(error.errorDetails?.details?.message || error.message) || error

		return {
			details: errorDetails,
			message: errorDetails?.message || error.message || "An unknown error occurred.",
			isStructured: true,
		}
	}

	// Handle text-based errors
	const errorMessage = apiRequestFailedMessage || apiReqStreamingFailedMessage || ""
	const errorData = parseErrorText(errorMessage)

	return {
		details: errorData,
		message: errorMessage,
		isStructured: false,
	}
}

const checkErrorType = (errorInfo: ErrorInfo) => {
	const message = errorInfo.message.toLowerCase()
	const details = errorInfo.details
	const errorDetails = details?.errorDetails

	return {
		isRateLimit:
			details?.status === 429 ||
			message.includes("rate limit") ||
			message.includes("too many requests") ||
			message.includes("quota exceeded") ||
			message.includes("resource exhausted"),

		isCreditLimit:
			details?.code === "insufficient_credits" ||
			(errorDetails?.code === "insufficient_credits" && typeof errorDetails?.current_balance === "number"),

		isAuth:
			details?.status === 401 ||
			(errorDetails?.status === 401 &&
				errorDetails?.message?.includes("Unauthorized: Please sign in to Cline before trying again.")),

		isPowerShell: message.includes("powershell") || errorDetails?.message?.toLowerCase().includes("powershell"),
	}
}

export const ErrorRow = memo<ErrorRowProps>(
	({ error, apiRequestFailedMessage, apiReqStreamingFailedMessage, clineUser, handleSignIn, pStyle }) => {
		console.error("ErrorRow", { error, apiRequestFailedMessage, apiReqStreamingFailedMessage })

		const errorInfo = useMemo(
			() => getErrorInfo(error, apiRequestFailedMessage, apiReqStreamingFailedMessage),
			[error, apiRequestFailedMessage, apiReqStreamingFailedMessage],
		)

		const errorTypes = useMemo(() => checkErrorType(errorInfo), [errorInfo])

		// Handle credit limit error with dedicated component
		if (errorTypes.isCreditLimit) {
			const details = errorInfo.details
			// Use details directly if available, otherwise fall back to errorDetails
			const creditDetails = details?.code === "insufficient_credits" ? details : details?.errorDetails

			return (
				<CreditLimitError
					currentBalance={creditDetails?.current_balance}
					totalSpent={creditDetails?.total_spent}
					totalPromotions={creditDetails?.total_promotions}
					message={creditDetails?.message || "Not enough credits available"}
					buyCreditsUrl={creditDetails?.buy_credits_url}
				/>
			)
		}
		console.log(clineUser, "clineUser")
		const displayMessage = errorInfo.details?.errorDetails?.message || errorInfo.message

		return (
			<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>
				{displayMessage}
				{errorTypes.isAuth && (
					<>
						<br />
						<br />
						{clineUser && !displayMessage?.includes("Unauthorized: Please sign in to Cline before trying again.") ? (
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>(Click "Retry" below)</span>
						) : (
							<VSCodeButton onClick={handleSignIn} className="w-full mb-4">
								Sign in to Cline
							</VSCodeButton>
						)}
					</>
				)}

				{errorTypes.isPowerShell && (
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
