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
	platform?: string;
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
	const platform = cleanHeaderValue(input.platform);
	const taskId = cleanHeaderValue(input.taskId);

	return {
		...DEFAULT_REQUEST_HEADERS,
		...(clientName ? { "X-CLIENT-TYPE": clientName } : {}),
		...(clientVersion ? { "X-CLIENT-VERSION": clientVersion } : {}),
		...(platform ? { "X-PLATFORM": platform } : {}),
		...(taskId ? { "X-Task-ID": taskId } : {}),
		...(input.headers ?? {}),
	};
}

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
