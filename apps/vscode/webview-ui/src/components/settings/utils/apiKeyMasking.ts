export const SAVED_API_KEY_MASK_CHARACTER = "•"

export function getSavedApiKeyMask(apiKeyLength: number | undefined): string {
	return SAVED_API_KEY_MASK_CHARACTER.repeat(Math.max(0, apiKeyLength ?? 0))
}

export function sanitizeMaskedApiKeyInput(value: string, savedMask: string): string | undefined {
	if (!savedMask || !value.includes(SAVED_API_KEY_MASK_CHARACTER)) {
		return value
	}

	if (value === savedMask) {
		return undefined
	}

	return value.split(SAVED_API_KEY_MASK_CHARACTER).join("")
}
