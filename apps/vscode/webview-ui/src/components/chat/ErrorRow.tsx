import type { ClineMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import { ClineError } from "../../../../src/services/error/ClineError"

interface ErrorRowProps {
	message: ClineMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	if (errorType === "diff_error") {
		return (
			<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
				The model used search patterns that do not match the file. Retrying…
			</div>
		)
	}

	if (errorType === "clineignore_error") {
		return (
			<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
				Cline tried to access <code>{message.text}</code>, which is blocked by <code>.clineignore</code>.
			</div>
		)
	}

	const rawError = apiRequestFailedMessage || apiReqStreamingFailedMessage
	if (!rawError) {
		return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>
	}

	const error = ClineError.parse(rawError)
	const errorMessage = error?._error.message || error?.message || rawError
	const requestId = error?.requestId

	return (
		<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
			{errorMessage}
			{requestId && <span className="block">AWS request ID: {requestId}</span>}
		</p>
	)
})

export default ErrorRow
