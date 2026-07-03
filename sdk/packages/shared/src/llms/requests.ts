import { isClineProvider } from "../providers/utils";

export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "cline-sdk",
};

export interface BuildClineRequestHeadersInput {
	providerId: string;
	headers?: Record<string, string>;
	clientName?: string;
	clientVersion?: string;
	userAgent?: string;
	platform?: string;
	platformVersion?: string;
	coreVersion?: string;
	isMultiRoot?: boolean;
	taskId?: string;
}

function cleanHeaderValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function buildClineRequestHeaders(
	input: BuildClineRequestHeadersInput,
): Record<string, string> | undefined {
	if (!isClineProvider(input.providerId)) {
		return input.headers;
	}

	const clientName = cleanHeaderValue(input.clientName);
	const clientVersion = cleanHeaderValue(input.clientVersion);
	const userAgent = cleanHeaderValue(input.userAgent);
	const platform = cleanHeaderValue(input.platform);
	const platformVersion = cleanHeaderValue(input.platformVersion);
	const coreVersion = cleanHeaderValue(input.coreVersion);
	const taskId = cleanHeaderValue(input.taskId);

	return {
		...DEFAULT_REQUEST_HEADERS,
		...(userAgent ? { "User-Agent": userAgent } : {}),
		...(clientName ? { "X-CLIENT-TYPE": clientName } : {}),
		...(clientVersion ? { "X-CLIENT-VERSION": clientVersion } : {}),
		...(platform ? { "X-PLATFORM": platform } : {}),
		...(platformVersion ? { "X-PLATFORM-VERSION": platformVersion } : {}),
		...(coreVersion ? { "X-CORE-VERSION": coreVersion } : {}),
		...(input.isMultiRoot !== undefined
			? { "X-IS-MULTIROOT": input.isMultiRoot ? "true" : "false" }
			: {}),
		...(taskId ? { "X-Task-ID": taskId } : {}),
		...(input.headers ?? {}),
	};
}

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
