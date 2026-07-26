import { serializeError } from "serialize-error"

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

export class BedrockCoderError extends Error {
	readonly title = "BedrockCoderError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// BedrockCoder: error?.error
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

	public get status(): number | undefined {
		return this._error.status
	}

	public get requestId(): string | undefined {
		return this._error.request_id
	}

	/**
	 * Parses a stringified error into a BedrockCoderError instance.
	 */
	static parse(errorStr?: string, modelId?: string): BedrockCoderError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return BedrockCoderError.transform(errorStr, modelId)
	}

	/**
	 * Transforms any object into a BedrockCoderError instance.
	 * Always returns a BedrockCoderError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): BedrockCoderError {
		try {
			// If already a BedrockCoderError, return it directly to prevent infinite recursion
			if (error instanceof BedrockCoderError) {
				return error
			}
			return new BedrockCoderError(JSON.parse(error), modelId, providerId)
		} catch {
			return new BedrockCoderError(error, modelId, providerId)
		}
	}
}
