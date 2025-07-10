import { t } from "../../../i18n"
import { serializeError } from "serialize-error"

/**
 * HTTP error interface for embedder errors
 */
export interface HttpError extends Error {
	status?: number
	response?: {
		status?: number
	}
}

/**
 * Common error types that can occur during embedder validation
 */
export interface ValidationError {
	status?: number
	message?: string
	name?: string
	code?: string
}

/**
 * Maps HTTP status codes to appropriate error messages
 */
export function getErrorMessageForStatus(status: number | undefined, embedderType: string): string | undefined {
	switch (status) {
		case 401:
		case 403:
			return t("embeddings:validation.authenticationFailed")
		case 404:
			return embedderType === "openai"
				? t("embeddings:validation.modelNotAvailable")
				: t("embeddings:validation.invalidEndpoint")
		case 429:
			return t("embeddings:validation.serviceUnavailable")
		default:
			if (status && status >= 400 && status < 600) {
				return t("embeddings:validation.configurationError")
			}
			return undefined
	}
}

/**
 * Extracts status code from various error formats
 */
export function extractStatusCode(error: any): number | undefined {
	// Direct status property
	if (error?.status) return error.status

	// Response status property
	if (error?.response?.status) return error.response.status

	// Extract from error message (e.g., "HTTP 404: Not Found")
	if (error?.message) {
		const match = error.message.match(/HTTP (\d+):/)
		if (match) {
			return parseInt(match[1], 10)
		}
	}

	// Use serialize-error as fallback for complex objects
	const serialized = serializeError(error)
	if (serialized?.status) return serialized.status
	if (serialized?.response?.status) return serialized.response.status

	return undefined
}

/**
 * Extracts error message from various error formats
 */
export function extractErrorMessage(error: any): string {
	if (error?.message) {
		return error.message
	}

	if (typeof error === "string") {
		return error
	}

	if (error && typeof error === "object" && "toString" in error) {
		try {
			return String(error)
		} catch {
			return "Unknown error"
		}
	}

	// Use serialize-error as fallback for complex objects
	const serialized = serializeError(error)
	if (serialized?.message) {
		return serialized.message
	}

	return "Unknown error"
}

/**
 * Standard validation error handler for embedder configuration validation
 * Returns a consistent error response based on the error type
 */
export function handleValidationError(
	error: any,
	embedderType: string,
	customHandlers?: {
		beforeStandardHandling?: (error: any) => { valid: boolean; error: string } | undefined
	},
): { valid: boolean; error: string } {
	// Serialize the error to ensure we have access to all properties
	const serializedError = serializeError(error)

	// Allow custom handling first (pass original error for backward compatibility)
	if (customHandlers?.beforeStandardHandling) {
		const customResult = customHandlers.beforeStandardHandling(error)
		if (customResult) return customResult
	}

	// Extract status code and error message from serialized error
	const statusCode = extractStatusCode(serializedError)
	const errorMessage = extractErrorMessage(serializedError)

	// Check for status-based errors first
	const statusError = getErrorMessageForStatus(statusCode, embedderType)
	if (statusError) {
		return { valid: false, error: statusError }
	}

	// Check for connection errors
	if (errorMessage) {
		if (
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("ETIMEDOUT") ||
			errorMessage === "AbortError" ||
			errorMessage.includes("HTTP 0:") ||
			errorMessage === "No response"
		) {
			return { valid: false, error: t("embeddings:validation.connectionFailed") }
		}

		if (errorMessage.includes("Failed to parse response JSON")) {
			return { valid: false, error: t("embeddings:validation.invalidResponse") }
		}
	}

	// For generic errors, preserve the original error message if it's not a standard one
	if (errorMessage && errorMessage !== "Unknown error") {
		return { valid: false, error: errorMessage }
	}

	// Fallback to generic error
	return { valid: false, error: t("embeddings:validation.configurationError") }
}

/**
 * Wraps an async validation function with standard error handling
 */
export async function withValidationErrorHandling<T extends { valid: boolean; error?: string }>(
	validationFn: () => Promise<T>,
	embedderType: string,
	customHandlers?: Parameters<typeof handleValidationError>[2],
): Promise<{ valid: boolean; error?: string }> {
	try {
		return await validationFn()
	} catch (error) {
		return handleValidationError(error, embedderType, customHandlers)
	}
}

/**
 * Formats an embedding error message based on the error type and context
 */
export function formatEmbeddingError(error: any, maxRetries: number): Error {
	const errorMessage = extractErrorMessage(error)
	const statusCode = extractStatusCode(error)

	if (statusCode === 401) {
		return new Error(t("embeddings:authenticationFailed"))
	} else if (statusCode) {
		return new Error(t("embeddings:failedWithStatus", { attempts: maxRetries, statusCode, errorMessage }))
	} else {
		return new Error(t("embeddings:failedWithError", { attempts: maxRetries, errorMessage }))
	}
}
