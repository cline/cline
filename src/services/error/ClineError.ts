import { serializeError } from "../../utils/error"

export class ClineError extends Error {
	public readonly title = "ClineError"
	public readonly originalError?: Error
	public readonly errorDetails: {
		message: string
		code?: string
		status?: number
		details?: any
	}

	constructor(error: Error, request_id?: string)
	constructor(message: string, request_id?: string)
	constructor(
		_error: unknown,
		public readonly request_id?: string,
	) {
		// Safely serialize the error to avoid circular references
		const serializedError = serializeError(_error)

		super(serializedError.message)

		this.errorDetails = serializedError
		this.request_id = request_id || serializedError.request_id

		if (_error instanceof Error) {
			this.originalError = _error
			this.stack = _error.stack
			this.name = _error.name
			// Copy any additional enumerable properties from the original error
			Object.keys(_error).forEach((key) => {
				if (key !== "message" && key !== "stack" && key !== "name") {
					;(this as any)[key] = (_error as any)[key]
				}
			})
		}
	}

	/**
	 * Get a JSON-serializable representation of the error
	 */
	toJSON() {
		return {
			message: this.message,
			title: this.title,
			request_id: this.request_id,
			errorDetails: this.errorDetails,
			stack: this.stack,
		}
	}
}

export function isClineError(error: unknown): error is ClineError {
	return error instanceof ClineError
}
