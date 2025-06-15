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
