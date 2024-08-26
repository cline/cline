const KODU_BASE_URL = "https://kodu.ai"

export function getKoduSignInUrl(uriScheme?: string) {
	return `${KODU_BASE_URL}/auth/login?redirectTo=${uriScheme}://saoudrizwan.claude-dev&ext=1`
}

export function getKoduAddCreditsUrl(uriScheme?: string) {
	return `${KODU_BASE_URL}/cloud/plan`
}

export function getKoduCreditsUrl() {
	return `${KODU_BASE_URL}/api/credits`
}

export function getKoduInferenceUrl() {
	return `${KODU_BASE_URL}/api/inference-stream`
}

export function getKoduHomepageUrl() {
	return `${KODU_BASE_URL}`
}
