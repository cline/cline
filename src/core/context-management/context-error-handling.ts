export function checkIsOpenRouterContextWindowError(error: any): boolean {
	return error.code === 400 && error.message?.includes("context length")
}

export function checkIsAnthropicContextWindowError(response: any): boolean {
	return (
		response?.error?.error?.type === "invalid_request_error" &&
		response?.error?.error?.message?.includes("prompt is too long")
	)
}
