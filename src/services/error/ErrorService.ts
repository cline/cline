import { ClineError } from "./ClineError"
import { ErrorProviderFactory } from "./ErrorProviderFactory"
import { IErrorProvider } from "./providers/IErrorProvider"

/**
 * ErrorService handles error logging and tracking for the Cline extension
 * Uses an abstracted error provider to support multiple error tracking backends
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
export class ErrorService {
	private static instance: ErrorService | null = null

	private provider: IErrorProvider

	/**
	 * Sets up the ErrorService singleton.
	 */
	public static async initialize(): Promise<ErrorService> {
		if (ErrorService.instance) {
			throw new Error("ErrorService has already been initialized.")
		}

		const provider = await ErrorProviderFactory.createProvider(ErrorProviderFactory.getDefaultConfig())
		ErrorService.instance = new ErrorService(provider)
		return ErrorService.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static get(): ErrorService {
		if (!ErrorService.instance) {
			throw new Error("ErrorService not setup. Call ErrorService.initialize() first.")
		}
		return ErrorService.instance
	}

	constructor(provider: IErrorProvider) {
		this.provider = provider
	}

	public logException(error: Error | ClineError, properties?: Record<string, unknown>): void {
		this.provider.logException(error, properties)
		console.error("[ErrorService] Logging exception", JSON.stringify(error))
	}

	public logMessage(
		message: string,
		level: "error" | "warning" | "log" | "debug" | "info" = "log",
		properties?: Record<string, unknown>,
	): void {
		this.provider.logMessage(message, level, properties)
	}

	public toClineError(rawError: unknown, modelId?: string, providerId?: string): ClineError {
		const transformed = ClineError.transform(rawError, modelId, providerId)
		this.logException(transformed, { modelId, providerId })
		return transformed
	}

	/**
	 * Check if error logging is currently enabled
	 * @returns Boolean indicating whether error logging is enabled
	 */
	public isEnabled(): boolean {
		return this.provider.isEnabled()
	}

	/**
	 * Get current error logging settings
	 * @returns Current error logging settings
	 */
	public getSettings() {
		return this.provider.getSettings()
	}

	/**
	 * Get the error provider instance
	 * @returns The current error provider
	 */
	public getProvider(): IErrorProvider {
		return this.provider
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
