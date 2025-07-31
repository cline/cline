import * as pkg from "../../../package.json"
import type { PostHogClientProvider } from "../posthog/PostHogClientProvider"
import { ClineError } from "./ClineError"

const isDev = process.env.IS_DEV === "true"
const EXTENSION_ID = "saoudrizwan.claude-dev"

export class ErrorService {
	private posthogProvider: PostHogClientProvider

	constructor(posthogProvider: PostHogClientProvider, _distinctId: string) {
		this.posthogProvider = posthogProvider
		console.info("[ErrorService] Initialized with PostHogClientProvider")
	}

	public logException(error: Error | ClineError): void {
		console.error("[ErrorService] logException", error)
		const isClineExtError = error.stack?.includes(EXTENSION_ID)
		if (!isClineExtError) {
			return
		}

		const errorDetails = {
			message: error.message,
			stack: error.stack,
			name: error.name,
			extension_version: pkg.version,
			is_dev: isDev,
		}

		if (error instanceof ClineError) {
			Object.assign(errorDetails, {
				modelId: error.modelId,
				providerId: error.providerId,
				serialized_error: error.serialize(),
			})
		}

		this.posthogProvider.log("extension.error", {
			error_type: "exception",
			...errorDetails,
			timestamp: new Date().toISOString(),
		})

		console.error("[ErrorService] Logging", error)
	}

	public logMessage(message: string, level: "error" | "warning" | "log" | "debug" | "info" = "log"): void {
		this.posthogProvider.log("extension.message", {
			message: message.substring(0, 500),
			level,
			extension_version: pkg.version,
			is_dev: isDev,
			timestamp: new Date().toISOString(),
		})
	}

	public toClineError(rawError: unknown, modelId?: string, providerId?: string): ClineError {
		const transformed = ClineError.transform(rawError, modelId, providerId)
		this.logException(transformed)
		return transformed
	}
}
