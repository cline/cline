export function checkIsOpenRouterContextWindowError(error: any): boolean {
	return error.code === 400 && error.message?.includes("context length")
}
