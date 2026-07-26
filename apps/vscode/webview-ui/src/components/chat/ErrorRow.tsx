import type { BedrockCoderMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import { BedrockCoderError } from "../../../../src/services/error/BedrockCoderError"

interface ErrorRowProps {
	message: BedrockCoderMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "bedrockCoderignore_error"
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

	if (errorType === "bedrockCoderignore_error") {
		return (
			<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
				Bedrock Coder tried to access <code>{message.text}</code>, which is blocked by <code>.bedrock-coderignore</code>.
			</div>
		)
	}

	const rawError = apiRequestFailedMessage || apiReqStreamingFailedMessage
	if (!rawError) {
		return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>
	}

	const error = BedrockCoderError.parse(rawError)
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
