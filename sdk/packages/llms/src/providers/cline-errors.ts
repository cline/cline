import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ProviderErrorInfo,
} from "@cline/shared";

interface ResolveClineProviderErrorInfoInput {
	error: unknown;
	message: string;
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStructuredString(value: string): unknown | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function collectStructuredRecords(
	value: unknown,
	records: Record<string, unknown>[],
	seen: WeakSet<object>,
): void {
	if (typeof value === "string") {
		const parsed = parseStructuredString(value);
		if (parsed !== undefined) {
			collectStructuredRecords(parsed, records, seen);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectStructuredRecords(item, records, seen);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}

	if (seen.has(value)) {
		return;
	}
	seen.add(value);
	records.push(value);

	for (const key of [
		"error",
		"errors",
		"detail",
		"details",
		"message",
		"data",
		"body",
		"response",
		"responseBody",
		"cause",
	]) {
		if (key in value) {
			collectStructuredRecords(value[key], records, seen);
		}
	}
}

function getString(
	record: Record<string, unknown>,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

function getNumber(
	record: Record<string, unknown>,
	...keys: string[]
): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (
			typeof value === "string" &&
			value.trim().length > 0 &&
			Number.isFinite(Number(value))
		) {
			return Number(value);
		}
	}
	return undefined;
}

function getHeaderValue(headers: unknown, name: string): string | undefined {
	if (!headers) {
		return undefined;
	}
	const get = isRecord(headers) ? headers.get : undefined;
	if (typeof get === "function") {
		const value = get.call(headers, name);
		return typeof value === "string" && value.trim().length > 0
			? value.trim()
			: undefined;
	}
	if (!isRecord(headers)) {
		return undefined;
	}
	const direct = getString(headers, name, name.toLowerCase());
	if (direct) {
		return direct;
	}
	const normalizedName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (
			key.toLowerCase() === normalizedName &&
			typeof value === "string" &&
			value.trim().length > 0
		) {
			return value.trim();
		}
	}
	return undefined;
}

function findStatus(
	records: readonly Record<string, unknown>[],
): number | undefined {
	for (const record of records) {
		const status = getNumber(record, "status", "statusCode", "status_code");
		if (status !== undefined) {
			return status;
		}
	}
	return undefined;
}

function findRequestId(
	records: readonly Record<string, unknown>[],
): string | undefined {
	for (const record of records) {
		const requestId = getString(
			record,
			"request_id",
			"requestId",
			"x-request-id",
		);
		if (requestId) {
			return requestId;
		}
		const headerRequestId =
			getHeaderValue(record.headers, "x-request-id") ??
			getHeaderValue(record.headers, "request-id");
		if (headerRequestId) {
			return headerRequestId;
		}
	}
	return undefined;
}

function findCodeRecord(records: readonly Record<string, unknown>[]):
	| {
			record: Record<string, unknown>;
			code: string;
	  }
	| undefined {
	for (const record of records) {
		const code = getString(record, "code", "error_code", "errorCode");
		if (code) {
			return { record, code };
		}
	}
	return undefined;
}

const DETAIL_IDENTITY_KEYS = new Set([
	"code",
	"error_code",
	"errorCode",
	"status",
	"statusCode",
	"status_code",
	"request_id",
	"requestId",
	"message",
	"detail",
]);

const DETAIL_STRUCTURAL_KEYS = new Set([
	"error",
	"errors",
	"data",
	"body",
	"response",
	"responseBody",
	"cause",
	"headers",
]);

function shouldSkipDetailKey(key: string): boolean {
	return DETAIL_IDENTITY_KEYS.has(key) || DETAIL_STRUCTURAL_KEYS.has(key);
}

function copyNestedDetails(
	value: unknown,
	target: Record<string, unknown>,
): void {
	if (!isRecord(value)) {
		return;
	}
	for (const [key, nestedValue] of Object.entries(value)) {
		if (key === "details" || shouldSkipDetailKey(key)) {
			continue;
		}
		target[key] = nestedValue;
	}
}

function buildDetails(
	record: Record<string, unknown>,
): Record<string, unknown> {
	const details: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key === "details") {
			copyNestedDetails(value, details);
			continue;
		}
		if (shouldSkipDetailKey(key)) {
			continue;
		}
		details[key] = value;
	}
	return details;
}

export function resolveClineProviderErrorInfo(
	input: ResolveClineProviderErrorInfoInput,
): ProviderErrorInfo | undefined {
	const records: Record<string, unknown>[] = [];
	collectStructuredRecords(input.error, records, new WeakSet());
	const codeRecord = findCodeRecord(records);
	if (!codeRecord) {
		return undefined;
	}

	const message =
		getString(codeRecord.record, "message", "detail") ?? input.message;
	const status = findStatus(records);
	const requestId = findRequestId(records);
	const details = buildDetails(codeRecord.record);

	return {
		kind: "provider",
		providerId: input.request.providerId,
		modelId: input.request.modelId,
		message,
		code: codeRecord.code,
		...(status !== undefined ? { status } : {}),
		...(requestId ? { requestId } : {}),
		...(Object.keys(details).length > 0 ? { details } : {}),
	};
}
