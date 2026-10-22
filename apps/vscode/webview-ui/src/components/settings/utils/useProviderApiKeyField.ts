import { useCallback } from "react"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "./apiKeyMasking"

interface UseProviderApiKeyFieldOptions {
	apiKeyLength?: number
	onApiKeyChange?: (apiKey: string) => void
	providerName: string
	write: (patch: { apiKey: string }) => Promise<unknown>
}

export function useProviderApiKeyField({ apiKeyLength, onApiKeyChange, providerName, write }: UseProviderApiKeyFieldOptions) {
	const savedApiKeyMask = getSavedApiKeyMask(apiKeyLength)

	// Intentionally no "config loaded" gate: keys typed while the provider
	// config is still loading must persist, not be silently dropped and then
	// wiped by the late initialValue resync.
	const handleApiKeyChange = useCallback(
		(value: string) => {
			const apiKey = sanitizeMaskedApiKeyInput(value, savedApiKeyMask)

			if (apiKey === undefined) {
				return
			}

			onApiKeyChange?.(apiKey)
			void write({ apiKey }).catch((err) => console.error(`Failed to update ${providerName} API key:`, err))
		},
		[onApiKeyChange, providerName, savedApiKeyMask, write],
	)

	return { savedApiKeyMask, handleApiKeyChange }
}
