import { useCallback } from "react"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "./apiKeyMasking"

interface UseProviderApiKeyFieldOptions {
	apiKeyLength?: number
	canWrite?: boolean
	onApiKeyChange?: (apiKey: string) => void
	providerName: string
	write: (patch: { apiKey: string }) => Promise<unknown>
}

export function useProviderApiKeyField({
	apiKeyLength,
	canWrite = true,
	onApiKeyChange,
	providerName,
	write,
}: UseProviderApiKeyFieldOptions) {
	const savedApiKeyMask = getSavedApiKeyMask(apiKeyLength)

	const handleApiKeyChange = useCallback(
		(value: string) => {
			if (!canWrite) {
				return
			}

			const apiKey = sanitizeMaskedApiKeyInput(value, savedApiKeyMask)

			if (apiKey === undefined) {
				return
			}

			onApiKeyChange?.(apiKey)
			void write({ apiKey }).catch((err) => console.error(`Failed to update ${providerName} API key:`, err))
		},
		[canWrite, onApiKeyChange, providerName, savedApiKeyMask, write],
	)

	return { savedApiKeyMask, handleApiKeyChange }
}
