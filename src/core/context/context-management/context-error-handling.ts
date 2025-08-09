import LengthFinishReasonError, { APIError } from "openai"

const KNOWN_OPENAI_ERROR_SUBSTRINGS = ["token", "context length"] as const

function hasKnownErrorSubstring(errorMessage: string): boolean {
	return KNOWN_OPENAI_ERROR_SUBSTRINGS.some((substring) => errorMessage.includes(substring))
}

export function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		return error?.code === 400 && hasKnownErrorSubstring(error.message)
	} catch {
		return false
	}
}

export function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return (response as any)?.error?.error?.type === "invalid_request_error"
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
export function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		if (error instanceof LengthFinishReasonError) {
			return true
		}
		return (
			Boolean(error) &&
			error instanceof APIError &&
			error.code?.toString() === "400" &&
			hasKnownErrorSubstring(error.message)
		)
	} catch {
		return false
	}
}
