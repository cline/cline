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
export async function getErrorService(): Promise<ErrorService> {
	if (!_errorServiceInstance) {
		console.warn("CREATING ERROR SERVICE... sjfsjf")

		const provider = await ErrorProviderFactory.createProvider(ErrorProviderFactory.getDefaultConfig())
		console.warn("CREATED ERROR PROVIDER sjfsjf")
		_errorServiceInstance = new ErrorService(provider)
		console.warn("CREATED ErrorService is set sjfsjf")
	}
	return _errorServiceInstance
}

/**
 * Reset the error service instance (useful for testing)
 */
export function resetErrorService(): void {
	_errorServiceInstance = null
}

// Export errorService as a getter that dynamically calls getErrorService()
// This ensures it always returns the current instance without changing call sites
export const errorService = new Proxy({} as ErrorService, {
	get(_target, prop, _receiver) {
		// Return a function that will call the method on the actual service
		return async (...args: any[]) => {
			const service: ErrorService = await getErrorService()
			const method = Reflect.get(service, prop, service)
			if (typeof method === "function") {
				return method.apply(service, args)
			}
			return method
		}
	},
})
