/**
 * Safely serialize an error object to avoid circular reference issues
 */
export function serializeError(error: unknown): {
	message: string
	code?: string
	status?: number
	request_id?: string
	details?: any
} {
	if (error instanceof Error) {
		return {
			message: error.message,
			code: (error as any).code,
			status: (error as any).status,
			request_id: (error as any).request_id,
			details: extractSafeErrorDetails(error),
		}
	}

	// Handle axios errors
	if (error && typeof error === "object" && "isAxiosError" in error) {
		const axiosError = error as any
		return {
			message: axiosError.message || "Network request failed",
			code: axiosError.code,
			status: axiosError.response?.status,
			request_id: axiosError.request_id,
			details: {
				url: axiosError.config?.url,
				method: axiosError.config?.method,
				statusText: axiosError.response?.statusText,
			},
		}
	}

	// Handle other error-like objects
	if (error && typeof error === "object") {
		return {
			message: (error as any).message || String(error),
			code: (error as any).code,
			status: (error as any).status,
			request_id: (error as any).request_id,
			details: extractSafeErrorDetails(error),
		}
	}

	return {
		message: String(error),
	}
}

/**
 * Extract safe error details that can be serialized without circular references
 */
function extractSafeErrorDetails(error: any): any {
	const safeDetails: any = {}

	// Extract common error properties that are safe to serialize
	const safeProperties = [
		"name",
		"code",
		"status",
		"statusText",
		"url",
		"method",
		"response",
		"request_id",
		"error",
		"metadata",
	]

	for (const prop of safeProperties) {
		if (error[prop] !== undefined) {
			// For response objects, only extract safe properties
			if (prop === "response" && error[prop] && typeof error[prop] === "object") {
				safeDetails[prop] = {
					status: error[prop].status,
					statusText: error[prop].statusText,
					data: error[prop].data,
				}
			} else {
				safeDetails[prop] = error[prop]
			}
		}
	}

	return safeDetails
}

/**
 * Create a safe error message that can be displayed in the UI
 */
export function createSafeErrorMessage(error: unknown): string {
	const serialized = serializeError(error)

	// Handle specific error types
	if (serialized.code === "ERR_BAD_REQUEST" || serialized.status === 401) {
		return "Unauthorized: Please sign in to Cline before trying again."
	}

	if (serialized.details?.error?.code === "insufficient_credits" && serialized.status === 402) {
		try {
			return JSON.stringify(serialized.details.error)
		} catch {
			return "Insufficient credits. Please add more credits to continue."
		}
	}

	// Handle network errors
	if (serialized.code === "ECONNREFUSED" || serialized.code === "ENOTFOUND") {
		return "Network connection failed. Please check your internet connection and try again."
	}

	if (serialized.code === "ETIMEDOUT") {
		return "Request timed out. Please try again."
	}

	// Return the main error message
	return serialized.message || "An unexpected error occurred."
}
