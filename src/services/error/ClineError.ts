import { serializeError } from "serialize-error"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount"

export enum ClineErrorType {
	Auth = "auth",
	Network = "network",
	RateLimit = "rateLimit",
	Balance = "balance",
}

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

export class ClineError extends Error {
	readonly title = "ClineError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// Cline: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public readonly modelId?: string,
		public readonly providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || error?.response?.message || String(error) || error?.cause?.means
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status
		this.modelId = modelId || error.modelId
		this.providerId = providerId || error.providerId

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			...error,
			message: raw.message || message,
			status,
			request_id:
				error.error?.request_id ||
				error.request_id ||
				error.response?.request_id ||
				error.response?.headers?.["x-request-id"],
			code: error.code || error?.cause?.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: error.details || error.error, // Additional details provided by the server
			stack: undefined, // Avoid serializing stack trace to keep the error object clean
		}
	}

	/**
	 *  Serializes the error to a JSON string that allows for easy transmission and storage.
	 *  This is useful for logging or sending error details to a webviews.
	 */
	public serialize(): string {
		return JSON.stringify({
			message: this.message,
			status: this._error.status,
			request_id: this._error.request_id,
			code: this._error.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: this._error.details,
		})
	}

	/**
	 * Parses a stringified error into a ClineError instance.
	 */
	static parse(errorStr?: string, modelId?: string): ClineError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return ClineError.transform(errorStr, modelId)
	}

	/**
	 * Transforms any object into a ClineError instance.
	 * Always returns a ClineError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): ClineError {
		try {
			// If already a ClineError, return it directly to prevent infinite recursion
			if (error instanceof ClineError) {
				return error
			}
			return new ClineError(JSON.parse(error), modelId, providerId)
		} catch {
			return new ClineError(error, modelId, providerId)
		}
	}

	public isErrorType(type: ClineErrorType): boolean {
		return ClineError.getErrorType(this) === type
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: ClineError): ClineErrorType | undefined {
		const { code, status, details } = err._error
		const message = (err._error?.message || err.message || JSON.stringify(err._error))?.toLowerCase()

		// Check balance error first (most specific)
		if (code === "insufficient_credits" && typeof details?.current_balance === "number") {
			return ClineErrorType.Balance
		}

		// Check auth errors
		const isAuthStatus = status !== undefined && status > 400 && status < 429
		if (code === "ERR_BAD_REQUEST" || err instanceof AuthInvalidTokenError || isAuthStatus) {
			return ClineErrorType.Auth
		}

		if (message) {
			// Check for specific error codes/messages if applicable
			const authErrorRegex = [/(?:in)?valid[-_ ]?(?:api )?(?:token|key)/i, /authentication[-_ ]?failed/i, /unauthorized/i]
			if (message?.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) || authErrorRegex.some((regex) => regex.test(message))) {
				return ClineErrorType.Auth
			}

			// Check rate limit patterns
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return ClineErrorType.RateLimit
			}
		}

		return undefined
	}
}

export class AuthNetworkError extends Error {
	constructor(
		message: string,
		override readonly cause?: Error,
	) {
		super(message)
		this.name = ClineErrorType.Network
	}
}

export class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = ClineErrorType.Auth
	}
}
