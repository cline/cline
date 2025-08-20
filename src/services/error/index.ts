export { ClineError, ClineErrorType } from "./ClineError"
export { type ErrorProviderConfig, ErrorProviderFactory, type ErrorProviderType } from "./ErrorProviderFactory"
export { ErrorService } from "./ErrorService"
export type { ErrorSettings, IErrorProvider } from "./providers/IErrorProvider"
export { PostHogErrorProvider } from "./providers/PostHogErrorProvider"

import { ErrorProviderFactory } from "./ErrorProviderFactory"
import { ErrorService } from "./ErrorService"

let _errorServiceInstance: ErrorService | null = null

/**
 * Get the singleton error service instance
 * @param distinctId Optional distinct ID for the error provider
 * @returns ErrorService instance
 */
export function getErrorService(): ErrorService {
	if (!_errorServiceInstance) {
		const provider = ErrorProviderFactory.createProvider({
			type: "posthog",
		})
		_errorServiceInstance = new ErrorService(provider)
	}
	return _errorServiceInstance
}

/**
 * Reset the error service instance (useful for testing)
 */
export function resetErrorService(): void {
	_errorServiceInstance = null
}

export const errorService = getErrorService()
