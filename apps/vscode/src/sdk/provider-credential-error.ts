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

/**
 * Actionable text for a credential rejection (HTTP 401/403) from a BYOK
 * provider. The provider's raw body is appended because it is the only
 * provider-specific diagnostic the user has — but alone it is a dead end
 * (e.g. Mistral answers an identical `{"detail":"Invalid API Key"}` for a
 * wrong, empty, or wrong-scope key).
 */
export function describeCredentialRejectedError(rawMessage: string, providerId: string): string {
	const subject = `Provider "${providerId}" rejected the configured credentials.`
	const guidance =
		"Re-enter the API key in Settings → API Configuration (checking it is the right kind of key for this provider), or switch providers."
	const detail = rawMessage.trim()
	return detail ? `${subject} ${guidance}\n\nProvider response: ${detail}` : `${subject} ${guidance}`
}
