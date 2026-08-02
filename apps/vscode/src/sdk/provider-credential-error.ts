const MISSING_AUTH_HEADER = /\b(?:missing|no)\s+authorization\s+header\b|\bauthorization\s+header\s+is\s+required\b/i

export function describeMissingCredentialError(rawMessage: string, providerId: string): string | undefined {
	if (!MISSING_AUTH_HEADER.test(rawMessage)) {
		return undefined
	}
	return `Missing API key for provider "${providerId}". Add credentials in Settings, or switch providers.`
}
