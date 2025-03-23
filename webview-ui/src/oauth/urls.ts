export function getCallbackUrl(provider: string, uriScheme?: string) {
	const callbackUrl = `${uriScheme || "vscode"}://rooveterinaryinc.roo-cline/${provider}`
	return encodeURIComponent(callbackUrl)
}

export function getGlamaAuthUrl(uriScheme?: string) {
	return `https://glama.ai/oauth/authorize?callback_url=${getCallbackUrl("glama", uriScheme)}`
}

export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${getCallbackUrl("openrouter", uriScheme)}`
}

export function getRequestyAuthUrl(uriScheme?: string) {
	return `https://app.requesty.ai/oauth/authorize?callback_url=${getCallbackUrl("requesty", uriScheme)}`
}
