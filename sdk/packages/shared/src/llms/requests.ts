export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "cline-sdk",
};

function isClineBillingProvider(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}

function trimNonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveSource(
	source: string | undefined,
	defaultSource: string,
): string {
	return trimNonEmpty(source) ?? defaultSource;
}

function resolveClineClientVersion(input: {
	clientVersion?: string;
	clientVersionHeaderFallback?: string;
}): string {
	return (
		trimNonEmpty(input.clientVersion) ??
		trimNonEmpty(input.clientVersionHeaderFallback) ??
		"unknown"
	);
}

function resolveOptionalHeader(value: string | undefined): string | undefined {
	return trimNonEmpty(value);
}

export interface ClineClientRequestHeadersInput {
	providerId: string;
	sessionId: string;
	source?: string;
	defaultSource: string;
	clientName?: string;
	clientVersion?: string;
	clientVersionHeaderFallback?: string;
	platform?: string;
	platformVersion?: string;
	isMultiRoot?: boolean;
	coreVersion: string;
}

export function buildClineClientRequestHeaders(
	input: ClineClientRequestHeadersInput,
): Record<string, string> | undefined {
	if (!isClineBillingProvider(input.providerId)) {
		return undefined;
	}
	const source = resolveSource(input.source, input.defaultSource);
	const clientName =
		resolveOptionalHeader(input.clientName) ?? `cline-${source}`;
	const clientVersion = resolveClineClientVersion(input);
	const platform = resolveOptionalHeader(input.platform) ?? source;
	const platformVersion =
		resolveOptionalHeader(input.platformVersion) ?? clientVersion;
	return {
		...DEFAULT_REQUEST_HEADERS,
		"User-Agent": `Cline/${clientVersion}`,
		"X-IS-MULTIROOT": input.isMultiRoot === true ? "true" : "false",
		"X-CLIENT-TYPE": clientName,
		"X-CLIENT-VERSION": clientVersion,
		"X-PLATFORM": platform,
		"X-PLATFORM-VERSION": platformVersion,
		"X-CORE-VERSION": input.coreVersion,
		"X-Task-ID": input.sessionId,
	};
}

export interface MergeClineClientRequestHeadersInput
	extends ClineClientRequestHeadersInput {
	headers: ReadonlyArray<Record<string, string> | undefined>;
}

export function mergeClineClientRequestHeaders(
	input: MergeClineClientRequestHeadersInput,
): Record<string, string> | undefined {
	const requiredHeaders = buildClineClientRequestHeaders(input);
	if (!requiredHeaders) {
		return undefined;
	}
	return Object.assign({}, ...input.headers, requiredHeaders);
}

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
