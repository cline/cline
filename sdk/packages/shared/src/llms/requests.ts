import type { ExtensionContext } from "../extensions/context";
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
	extensionContext?: ExtensionContext;
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
	return trimmed && trimmed.toLowerCase() !== "unknown" ? trimmed : undefined;
}

function cleanHeaderOverrides(
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) {
		return undefined;
	}
	const cleaned = Object.fromEntries(
		Object.entries(headers).filter(([, value]) => cleanHeaderValue(value)),
	);
	return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function buildClineRequestHeaders(
	input: BuildClineRequestHeadersInput,
): Record<string, string> | undefined {
	if (!isClineProvider(input.providerId)) {
		return input.headers;
	}

	const requestMetadata = input.extensionContext?.requestMetadata;
	const clientName =
		cleanHeaderValue(input.clientName) ??
		cleanHeaderValue(requestMetadata?.clientType) ??
		cleanHeaderValue(input.extensionContext?.client?.name);
	const clientVersion =
		cleanHeaderValue(input.clientVersion) ??
		cleanHeaderValue(requestMetadata?.clientVersion) ??
		cleanHeaderValue(input.extensionContext?.client?.version);
	const userAgent =
		cleanHeaderValue(input.userAgent) ??
		cleanHeaderValue(requestMetadata?.userAgent);
	const platform =
		cleanHeaderValue(input.platform) ??
		cleanHeaderValue(requestMetadata?.platform);
	const platformVersion =
		cleanHeaderValue(input.platformVersion) ??
		cleanHeaderValue(requestMetadata?.platformVersion);
	const coreVersion =
		cleanHeaderValue(input.coreVersion) ??
		cleanHeaderValue(requestMetadata?.coreVersion);
	const isMultiRoot = input.isMultiRoot ?? requestMetadata?.isMultiRoot;
	const taskId = cleanHeaderValue(input.taskId);
	const headerOverrides = cleanHeaderOverrides(input.headers);

	return {
		...DEFAULT_REQUEST_HEADERS,
		...(headerOverrides ?? {}),
		...(userAgent ? { "User-Agent": userAgent } : {}),
		...(clientName ? { "X-CLIENT-TYPE": clientName } : {}),
		...(clientVersion ? { "X-CLIENT-VERSION": clientVersion } : {}),
		...(platform ? { "X-PLATFORM": platform } : {}),
		...(platformVersion ? { "X-PLATFORM-VERSION": platformVersion } : {}),
		...(coreVersion ? { "X-CORE-VERSION": coreVersion } : {}),
		...(isMultiRoot !== undefined
			? { "X-IS-MULTIROOT": isMultiRoot ? "true" : "false" }
			: {}),
		...(taskId ? { "X-Task-ID": taskId } : {}),
	};
}

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
