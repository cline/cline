import {
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineFreeModelLimitMessage,
	isClineModelNotFoundMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitMessage,
} from "@cline/llms"
import { serializeError } from "serialize-error"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount"

export enum ClineErrorType {
	Auth = "auth",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	Entitlement = "entitlement",
	OrgClinePassRestriction = "orgClinePassRestriction",
	ClinePassLimit = "clinePassLimit",
	ClineFreeModelLimit = "clineFreeModelLimit",
	ClineFreePromotionEnded = "clineFreePromotionEnded",
}

const CLINE_FREE_MODEL_PREFIX = "cline-free/"

// A retired free model reports model-not-found: once a promotion ends the
// cline-free/ id is dropped from the catalog while the user's selection still
// points at it. Matching is text based because the SDK path strips the
// provider's HTTP status, and the model-id gate keeps ordinary model-not-found
// errors on their generic path. Mirrors the CLI's detection in
// apps/cli/src/utils/cline-pass-errors.ts.
const MODEL_NOT_FOUND_PATTERN = /\bmodel\b[^.,;:]*\b(not[ _]?found|does not exist|no such model|unknown model)\b/i

// Providers nest the reason at different depths ("model not found" can arrive
// as the message, as details.message, or only inside the raw response body), so
// the retired-model check scans the whole serialized error too.
function stringifyErrorDetails(details: unknown): string | undefined {
	try {
		return JSON.stringify(details)
	} catch {
		return undefined
	}
}

function isRetiredFreeModelError(modelId: string | undefined, ...messages: (string | undefined)[]): boolean {
	if (!modelId?.startsWith(CLINE_FREE_MODEL_PREFIX)) {
		return false
	}
	return messages.some((message) =>
		message ? isClineModelNotFoundMessage(message) || MODEL_NOT_FOUND_PATTERN.test(message) : false,
	)
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

	public get status(): number | undefined {
		return this._error.status
	}

	public get requestId(): string | undefined {
		return this._error.request_id
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
		const rawMessage = err._error?.message || err.message || JSON.stringify(err._error)
		const message = rawMessage?.toLowerCase()
		const detailMessage = typeof details?.message === "string" ? details.message : undefined

		// Check balance error first (most specific)
		if (code === "insufficient_credits" && typeof details?.current_balance === "number") {
			return ClineErrorType.Balance
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (code === "SPEND_LIMIT_EXCEEDED" || details?.code === "SPEND_LIMIT_EXCEEDED") {
			return ClineErrorType.SpendLimit
		}

		if (
			rawMessage === getClineOrgIndividualInferenceSubscriptionMessage() ||
			(detailMessage ? isClineOrgIndividualInferenceSubscriptionMessage(detailMessage) : false) ||
			(rawMessage ? isClineOrgIndividualInferenceSubscriptionMessage(rawMessage) : false)
		) {
			return ClineErrorType.OrgClinePassRestriction
		}

		if (
			(detailMessage ? isClineNotSubscribedMessage(detailMessage) : false) ||
			(rawMessage ? isClineNotSubscribedMessage(rawMessage) : false)
		) {
			return ClineErrorType.Entitlement
		}

		if (
			(detailMessage ? isClineFreeModelLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClineFreeModelLimitMessage(rawMessage) : false)
		) {
			return ClineErrorType.ClineFreeModelLimit
		}

		// Must precede the auth check below: the API answers 404 for a retired
		// free model, which the status range would otherwise read as an auth
		// failure and render as a useless "click Retry" prompt.
		if (isRetiredFreeModelError(err.modelId, detailMessage, rawMessage, stringifyErrorDetails(err._error))) {
			return ClineErrorType.ClineFreePromotionEnded
		}

		if (
			(detailMessage ? isClinePassLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClinePassLimitMessage(rawMessage) : false)
		) {
			return ClineErrorType.ClinePassLimit
		}

		// Check auth errors
		const isAuthStatus = status !== undefined && status > 400 && status < 429
		if (code === "ERR_BAD_REQUEST" || err instanceof AuthInvalidTokenError || isAuthStatus) {
			return ClineErrorType.Auth
		}

		if (code === "INFERENCE_CAP_ERROR") {
			return ClineErrorType.QuotaExceeded
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

class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = ClineErrorType.Auth
	}
}
