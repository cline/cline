import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount"
import { serializeError } from "serialize-error"

export enum ClineErrorType {
	Auth = "auth",
	Network = "network",
	RateLimit = "rateLimit",
	Balance = "balance",
}

interface ErrorDetails {
	status?: number
	request_id?: string
	code?: string
	modelId?: string
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

export class ClineError extends Error {
	readonly title = "ClineError"
	readonly _error: ErrorDetails

	constructor(
		raw: any,
		public readonly modelId?: string,
		public readonly providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || String(error)
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			message: raw.message,
			status,
			request_id: error.request_id || error.response?.request_id,
			code: error.code,
			modelId,
			details: error.details || error.error, // Additional details provided by the server
			...error,
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

	static transform(error: any, modelId?: string, providerId?: string): ClineError {
		try {
			return new ClineError(JSON.parse(error), modelId, providerId)
		} catch {
			return new ClineError(error, modelId, providerId)
		}
	}

	public isErrorType(type: ClineErrorType): boolean {
		return ClineError.getErrorType(this) === type
	}

	static getErrorType(err: ClineError): ClineErrorType | undefined {
		const { code, status, details } = err._error

		// Check balance error first (most specific)
		if (code === "insufficient_credits" && typeof details?.current_balance === "number") {
			return ClineErrorType.Balance
		}

		// Check auth errors
		if (code === "ERR_BAD_REQUEST" || status === 401) {
			return ClineErrorType.Auth
		}

		// Check for auth message (only if message exists)
		const message = err.message
		if (message?.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)) {
			return ClineErrorType.Auth
		}

		// Check rate limit patterns
		if (message) {
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return ClineErrorType.RateLimit
			}
		}

		return undefined
	}
}
