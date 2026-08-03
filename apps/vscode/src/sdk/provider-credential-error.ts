const MISSING_AUTH_HEADER = /\b(?:missing|no)\s+authorization\s+header\b|\bauthorization\s+header\s+is\s+required\b/i

export function describeMissingCredentialError(rawMessage: string, providerId?: string): string | undefined {
	if (!MISSING_AUTH_HEADER.test(rawMessage)) {
		return undefined
	}
	// Only name the provider when the caller actually knows it — a fallback id
	// here would blame the wrong provider for the missing key.
	const subject = providerId ? `Missing API key for provider "${providerId}".` : "Missing API key for the active provider."
	return `${subject} Add credentials in Settings, or switch providers.`
}
