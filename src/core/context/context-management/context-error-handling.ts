export function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		return error.code === 400 && error.message?.includes("context length")
	} catch (e: unknown) {
		return false
	}
}

export function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch (e: unknown) {
		return false
	}
}

export function checkIsOpenAIContextWindowError(error: any): boolean {
	try {
		const status = error?.status ?? error?.code ?? error?.error?.status ?? error?.response?.status
		const code = error?.code ?? error?.error?.code
		const message: string = String(error?.message || error?.error?.message || "")

		// Known OpenAI signal
		if (code === "context_length_exceeded") {
			return true
		}

		// Fallback: typical message patterns (e.g., "Input tokens exceed the configured limit ...")
		const mentionsContext =
			/context\s*(length|window)/i.test(message) ||
			/input tokens exceed/i.test(message) ||
			/too many tokens/i.test(message) ||
			/maximum context/i.test(message)

		return (status === 400 || status === "400") && mentionsContext
	} catch (e: unknown) {
		return false
	}
}
