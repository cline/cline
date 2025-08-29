import LengthFinishReasonError, { APIError } from "openai"

export function checkContextWindowExceededError(error: unknown): boolean {
	return (
		checkIsOpenAIContextWindowError(error) ||
		checkIsOpenRouterContextWindowError(error) ||
		checkIsAnthropicContextWindowError(error) ||
		checkIsCerebrasContextWindowError(error)
	)
}

function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		const status = error?.status ?? error?.code ?? error?.error?.status ?? error?.response?.status
		const message: string = String(error?.message || error?.error?.message || "")

		// There seems to be an issue where the true status code is embedded only in the message itself
		const statusFromMessage = message.match(/"code":\s*(\d+)/)?.[1]
		const finalStatus = statusFromMessage || status

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
		] as const

		return String(finalStatus) === "400" && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		if (error instanceof LengthFinishReasonError) {
			return true
		}

		const KNOWN_CONTEXT_ERROR_SUBSTRINGS = ["token", "context length"] as const

		return (
			Boolean(error) &&
			error instanceof APIError &&
			error.code?.toString() === "400" &&
			KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) => error.message.includes(substring))
		)
	} catch {
		return false
	}
}

function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch {
		return false
	}
}

function checkIsCerebrasContextWindowError(response: any): boolean {
	try {
		const status = response?.status ?? response?.code ?? response?.error?.status ?? response?.response?.status
		const message: string = String(response?.message || response?.error?.message || "")

		return String(status) === "400" && message.includes("Please reduce the length of the messages or completion")
	} catch {
		return false
	}
}
