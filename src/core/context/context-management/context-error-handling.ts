import LengthFinishReasonError, { APIError } from "openai"

export function checkIsOpenAIOrOpenRouterStyleContextLimitError(error: unknown): boolean {
	return checkIsOpenAIContextWindowError(error) || checkIsOpenRouterContextWindowError(error)
}

function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		const status = error?.status ?? error?.code ?? error?.error?.status ?? error?.response?.status
		const message: string = String(error?.message || error?.error?.message || "")

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
		] as const

		return String(status) === "400" && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
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

export function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch {
		return false
	}
}
