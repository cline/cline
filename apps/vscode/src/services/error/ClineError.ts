import { serializeError } from "serialize-error";
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount";

export enum ClineErrorType {
	Auth = "auth",
	Network = "network",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	Entitlement = "entitlement",
	OrgClinePassRestriction = "orgClinePassRestriction",
	ClinePassLimit = "clinePassLimit",
}

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number;
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string;
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string;
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string;
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string;
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string;
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any;
}

const RATE_LIMIT_PATTERNS = [
	/status code 429/i,
	/rate limit/i,
	/too many requests/i,
	/quota exceeded/i,
	/resource exhausted/i,
];
const ORG_CLINE_PASS_RESTRICTION_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";
const ORG_CLINE_PASS_RESTRICTION_USER_MESSAGE =
	"organization accounts cannot use clinepass subscriptions";

// The ClinePass period limit message is dynamic ("weekly"/"5-hour" period, "7d"/"12h"
// reset), so it is matched by its fixed prefix/suffix with the ClinePass marker in
// between. Plain indexOf scanning — no regex, so no backtracking on hostile input.
const CLINE_PASS_LIMIT_PREFIX = "you have reached your";
const CLINE_PASS_LIMIT_MARKER = "clinepass limit";
const CLINE_PASS_LIMIT_SUFFIX = "please try again later.";

function findClinePassLimitMessageBounds(
	text: string,
): { start: number; end: number } | undefined {
	const normalized = text.toLowerCase();
	const start = normalized.indexOf(CLINE_PASS_LIMIT_PREFIX);
	if (start === -1) {
		return undefined;
	}

	const suffixStart = normalized.indexOf(CLINE_PASS_LIMIT_SUFFIX, start);
	if (suffixStart === -1) {
		return undefined;
	}

	const end = suffixStart + CLINE_PASS_LIMIT_SUFFIX.length;
	if (!normalized.slice(start, end).includes(CLINE_PASS_LIMIT_MARKER)) {
		return undefined;
	}

	return { start, end };
}

export function isClinePassLimitMessage(text: string): boolean {
	return findClinePassLimitMessageBounds(text) !== undefined;
}

export function extractClinePassLimitMessage(
	text: string,
): string | undefined {
	const bounds = findClinePassLimitMessageBounds(text);
	return bounds ? text.slice(bounds.start, bounds.end) : undefined;
}

export class ClineError extends Error {
	readonly title = "ClineError";
	readonly _error: ErrorDetails;

	// Error details per providers:
	// Cline: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public readonly modelId?: string,
		public readonly providerId?: string,
	) {
		const error = serializeError(raw);

		const message =
			error.message ||
			error?.response?.message ||
			String(error) ||
			error?.cause?.means;
		super(message);

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status;
		this.modelId = modelId || error.modelId;
		this.providerId = providerId || error.providerId;

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
		};
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
		});
	}

	/**
	 * Parses a stringified error into a ClineError instance.
	 */
	static parse(errorStr?: string, modelId?: string): ClineError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined;
		}
		return ClineError.transform(errorStr, modelId);
	}

	/**
	 * Transforms any object into a ClineError instance.
	 * Always returns a ClineError, even if the input is not a valid error object.
	 */
	static transform(
		error: any,
		modelId?: string,
		providerId?: string,
	): ClineError {
		try {
			// If already a ClineError, return it directly to prevent infinite recursion
			if (error instanceof ClineError) {
				return error;
			}
			return new ClineError(JSON.parse(error), modelId, providerId);
		} catch {
			return new ClineError(error, modelId, providerId);
		}
	}

	public isErrorType(type: ClineErrorType): boolean {
		return ClineError.getErrorType(this) === type;
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: ClineError): ClineErrorType | undefined {
		const { code, status, details } = err._error;
		const message = (
			err._error?.message ||
			err.message ||
			JSON.stringify(err._error)
		)?.toLowerCase();

		// Check balance error first (most specific)
		if (
			code === "insufficient_credits" &&
			typeof details?.current_balance === "number"
		) {
			return ClineErrorType.Balance;
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (
			code === "SPEND_LIMIT_EXCEEDED" ||
			details?.code === "SPEND_LIMIT_EXCEEDED"
		) {
			return ClineErrorType.SpendLimit;
		}

		// ClinePass entitlement errors are user-actionable and should not fall through to generic 403 auth.
		// The organization-account variant gets separate copy because subscribing is not the right action.
		const isEntitlementCode =
			code === "ENTITLEMENT_ERROR" || details?.code === "ENTITLEMENT_ERROR";
		const entitlementText =
			`${message ?? ""} ${details?.message ?? ""}`.toLowerCase();
		if (
			isEntitlementCode &&
			(entitlementText.includes(ORG_CLINE_PASS_RESTRICTION_MESSAGE) ||
				entitlementText.includes(ORG_CLINE_PASS_RESTRICTION_USER_MESSAGE))
		) {
			return ClineErrorType.OrgClinePassRestriction;
		}
		if (
			isEntitlementCode &&
			entitlementText.includes("not subscribed to required model plan")
		) {
			return ClineErrorType.Entitlement;
		}

		// ClinePass period limits (weekly/5-hour) are user-actionable (switch to
		// usage-based billing) and must not fall through to the generic 403 auth
		// handling below or the 429 rate-limit patterns.
		const detailMessage =
			typeof details?.message === "string" ? details.message : undefined;
		if (
			isClinePassLimitMessage(detailMessage ?? "") ||
			isClinePassLimitMessage(message ?? "")
		) {
			return ClineErrorType.ClinePassLimit;
		}

		// Check auth errors
		const isAuthStatus = status !== undefined && status > 400 && status < 429;
		if (
			code === "ERR_BAD_REQUEST" ||
			err instanceof AuthInvalidTokenError ||
			isAuthStatus
		) {
			return ClineErrorType.Auth;
		}

		if (code === "INFERENCE_CAP_ERROR") {
			return ClineErrorType.QuotaExceeded;
		}

		if (message) {
			// Check for specific error codes/messages if applicable
			const authErrorRegex = [
				/(?:in)?valid[-_ ]?(?:api )?(?:token|key)/i,
				/authentication[-_ ]?failed/i,
				/unauthorized/i,
			];
			if (
				message?.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
				authErrorRegex.some((regex) => regex.test(message))
			) {
				return ClineErrorType.Auth;
			}

			// Check rate limit patterns
			const lowerMessage = message.toLowerCase();
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return ClineErrorType.RateLimit;
			}
		}

		return undefined;
	}
}

export class AuthNetworkError extends Error {
	constructor(
		message: string,
		override readonly cause?: Error,
	) {
		super(message);
		this.name = ClineErrorType.Network;
	}
}

export class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = ClineErrorType.Auth;
	}
}
