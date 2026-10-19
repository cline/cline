import { safeJsonParse, safeJsonStringify } from "@cline/shared";

/** Google API quota detail carried in a 429 `RESOURCE_EXHAUSTED` body. */
export interface QuotaFailureDetail {
	quotaId?: string;
	quotaMetric?: string;
	retryDelay?: string;
}

const QUOTA_DETAIL_KEYS = [
	"error",
	"data",
	"responseBody",
	"cause",
	"errors",
	"lastError",
	"value",
] as const;

/**
 * Find Google's structured quota detail (`google.rpc.QuotaFailure` /
 * `RetryInfo` in `error.details`) wherever an SDK error carries it: parsed
 * `data`, a raw `responseBody`, or nested under a `RetryError`'s attempts.
 * Returns an empty detail when the body is a quota rejection without
 * violations, and `undefined` when no quota failure is present.
 */
export function extractQuotaFailure(
	value: unknown,
	visited = new Set<unknown>(),
	depth = 0,
): QuotaFailureDetail | undefined {
	if (value == null || depth > 8) {
		return undefined;
	}
	if (typeof value === "string") {
		const parsed = safeJsonParse<unknown>(value);
		return parsed === undefined
			? undefined
			: extractQuotaFailure(parsed, visited, depth + 1);
	}
	if (typeof value !== "object" || visited.has(value)) {
		return undefined;
	}
	visited.add(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = extractQuotaFailure(item, visited, depth + 1);
			if (found) {
				return found;
			}
		}
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const error =
		record.error && typeof record.error === "object"
			? (record.error as Record<string, unknown>)
			: undefined;
	const details = Array.isArray(error?.details)
		? error.details
		: Array.isArray(record.details)
			? record.details
			: undefined;
	if (details) {
		let detail: QuotaFailureDetail | undefined;
		for (const entry of details) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const typed = entry as Record<string, unknown>;
			const type = typeof typed["@type"] === "string" ? typed["@type"] : "";
			if (type.includes("QuotaFailure")) {
				detail ??= {};
				const violation = Array.isArray(typed.violations)
					? (typed.violations[0] as Record<string, unknown> | undefined)
					: undefined;
				if (typeof violation?.quotaId === "string") {
					detail.quotaId = violation.quotaId;
				}
				if (typeof violation?.quotaMetric === "string") {
					detail.quotaMetric = violation.quotaMetric;
				}
			} else if (type.includes("RetryInfo")) {
				detail ??= {};
				if (typeof typed.retryDelay === "string") {
					detail.retryDelay = typed.retryDelay;
				}
			}
		}
		if (detail) {
			return detail;
		}
	}
	if (error?.status === "RESOURCE_EXHAUSTED") {
		return {};
	}
	for (const key of QUOTA_DETAIL_KEYS) {
		const found = extractQuotaFailure(record[key], visited, depth + 1);
		if (found) {
			return found;
		}
	}
	return undefined;
}

const PER_DAY_QUOTA_PATTERN = /per[\s_-]?day|daily/i;

/**
 * Whether an error is a quota exhaustion a same-day retry cannot fix, as
 * opposed to a transient per-minute rate limit. Google marks daily quotas
 * in the quota id/metric; a quota body without either is treated as
 * exhausted, as is Google's bare quota message once structure is stripped.
 */
export function isQuotaExhaustedError(error: unknown): boolean {
	const quota = extractQuotaFailure(error);
	if (quota) {
		const label = `${quota.quotaId ?? ""} ${quota.quotaMetric ?? ""}`.trim();
		return !label || PER_DAY_QUOTA_PATTERN.test(label);
	}
	if (typeof error === "string") {
		return /exceeded your current quota/i.test(error);
	}
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		if (
			typeof record.message === "string" &&
			/exceeded your current quota/i.test(record.message)
		) {
			return true;
		}
	}
	return false;
}

function quotaSuffix(error: unknown): string | undefined {
	const quota = extractQuotaFailure(error);
	if (!quota) {
		return undefined;
	}
	const label = quota.quotaId ?? quota.quotaMetric;
	const parts = [
		...(label ? [`quota ${label}`] : []),
		...(quota.retryDelay ? [`retry after ${quota.retryDelay}`] : []),
	];
	return parts.length
		? ` (Google quota exceeded: ${parts.join(", ")})`
		: undefined;
}

export function extractErrorMessage(error: unknown): string {
	// Generic SDK wrappers carry no signal of their own — when present we prefer
	// the underlying cause/detail (e.g. AI SDK's AI_NoOutputGeneratedError).
	const GENERIC_WRAPPER_MESSAGES = new Set([
		"no output generated. check the stream for errors.",
	]);
	const isGenericWrapperMessage = (message: string): boolean =>
		GENERIC_WRAPPER_MESSAGES.has(message.trim().toLowerCase());

	const hasErrorMessage = (
		value: unknown,
	): value is { error_message: unknown } =>
		typeof value === "object" && value !== null && "error_message" in value;

	// Pulls a human-readable message out of structured provider fields
	// (error/detail/errors/responseBody) without falling back to a top-level
	// `message`. Shared by the Error and plain-object branches.
	const extractStructuredDetail = (value: object): string | undefined => {
		const payload = value as {
			error?: { message?: string } | string;
			errors?: unknown;
			detail?: string;
			responseBody?: unknown;
			value?: unknown;
		};
		if (typeof payload.error === "string" && payload.error.trim()) {
			return payload.error;
		}
		if (
			payload.error &&
			typeof payload.error === "object" &&
			typeof payload.error.message === "string" &&
			payload.error.message.trim()
		) {
			return payload.error.message;
		}
		if (typeof payload.detail === "string" && payload.detail.trim()) {
			return payload.detail;
		}
		if (Array.isArray(payload.errors)) {
			for (const nestedError of payload.errors) {
				const nested = extractStructuredMessage(nestedError);
				if (nested) {
					return nested;
				}
			}
		}
		// Some gateways forward the upstream provider's rejection under `value`,
		// with the original response body JSON-encoded in `value.error_message`
		// (e.g. Vercel AI Gateway relaying Alibaba Qwen context-length errors,
		// where the top-level message is just "Stream error occurred" and the
		// cause is an unrelated internal ZodError).
		if (hasErrorMessage(payload.value)) {
			const nested = extractStructuredMessage(payload.value.error_message);
			if (nested) {
				return nested;
			}
		}
		if ("responseBody" in payload && payload.responseBody !== value) {
			const nested = extractStructuredMessage(payload.responseBody);
			if (nested) {
				return nested;
			}
		}
		return undefined;
	};

	const extractStructuredMessage = (value: unknown): string | undefined => {
		if (!value) {
			return undefined;
		}
		if (typeof value === "string") {
			// JSON.parse never yields undefined, so undefined here means the
			// string wasn't JSON — fall back to the trimmed string itself.
			const parsed = safeJsonParse<unknown>(value);
			if (parsed !== undefined) {
				return extractStructuredMessage(parsed);
			}
			return value.trim() || undefined;
		}
		if (typeof value !== "object") {
			return undefined;
		}
		if (value instanceof Error) {
			const message = value.message.trim();
			const detailMessage = extractStructuredDetail(value);
			const cause = (value as { cause?: unknown }).cause;
			const causeMessage = extractStructuredMessage(cause);

			// Generic wrappers (e.g. "No output generated...") only matter as a
			// fallback — surface the underlying detail/cause instead.
			if (message && isGenericWrapperMessage(message)) {
				return detailMessage ?? causeMessage ?? undefined;
			}

			// Structured provider detail attached directly to the error
			// (responseBody/detail/error fields) is more useful than the bland
			// top-level Error message.
			if (detailMessage && detailMessage !== message) {
				return detailMessage;
			}

			// Otherwise preserve the wrapper message alongside its cause, e.g.
			// "fetch failed: SocketError: other side closed (UND_ERR_SOCKET)".
			if (causeMessage && message && causeMessage !== message) {
				const causeName =
					cause instanceof Error && cause.name && cause.name !== "Error"
						? `${cause.name}: `
						: "";
				const causeCode =
					cause && typeof cause === "object" && "code" in cause
						? (cause as { code?: unknown }).code
						: undefined;
				const codeSuffix =
					typeof causeCode === "string" && causeCode.trim()
						? ` (${causeCode})`
						: "";
				return `${message}: ${causeName}${causeMessage}${codeSuffix}`;
			}
			return causeMessage ?? (message || undefined);
		}

		const detail = extractStructuredDetail(value);
		if (detail) {
			return detail;
		}
		const payload = value as { cause?: unknown; message?: string };
		if ("cause" in payload && payload.cause !== value) {
			const nested = extractStructuredMessage(payload.cause);
			if (nested) {
				return nested;
			}
		}
		if (typeof payload.message === "string" && payload.message.trim()) {
			return payload.message;
		}
		return undefined;
	};

	const structuredMessage = extractStructuredMessage(error);
	if (structuredMessage) {
		const suffix = quotaSuffix(error);
		return suffix && !structuredMessage.includes(suffix)
			? `${structuredMessage}${suffix}`
			: structuredMessage;
	}

	// String() on a plain object yields "[object Object]" — JSON is at least
	// actionable for the user and for error-classification downstream.
	if (typeof error === "object" && error !== null) {
		const json = safeJsonStringify(error);
		if (json && json !== "{}" && json !== "null") {
			return json;
		}
	}
	return String(error);
}
