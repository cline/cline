export function checkIsOpenAIOrOpenRouterStyleContextLimitError(error: any): boolean {
	try {
		const status = error?.status ?? error?.code ?? error?.error?.status ?? error?.response?.status
		const message: string = String(error?.message || error?.error?.message || "")

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
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

export function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch (e: unknown) {
		return false
	}
}
