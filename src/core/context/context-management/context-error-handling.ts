export function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		return error.code === 400 && error.message?.includes("context length")
	} catch (e: unknown) {
		return false
	}
}

export function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return (
			response?.error?.error?.type === "invalid_request_error" &&
			response?.error?.error?.message?.includes("prompt is too long")
		)
	} catch (e: unknown) {
		return false
	}
}
