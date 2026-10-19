export function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) {
		end -= 1;
	}
	return value.slice(0, end);
}

function isVersionSegment(value: string): boolean {
	if (value.length < 2 || value.charCodeAt(0) !== 118) {
		return false;
	}
	for (let index = 1; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 48 || code > 57) {
			return false;
		}
	}
	return true;
}

export function resolveVercelAiGatewayBaseUrl(
	configuredBaseUrl: string | undefined,
	defaultBaseUrl: string,
): string {
	const baseUrl = trimTrailingSlashes(configuredBaseUrl ?? defaultBaseUrl);
	if (baseUrl.endsWith("/v4/ai")) {
		return baseUrl;
	}

	const versionEnd = baseUrl.endsWith("/ai")
		? baseUrl.length - "/ai".length
		: baseUrl.length;
	const versionStart = baseUrl.lastIndexOf("/", versionEnd - 1);
	if (
		versionStart >= 0 &&
		isVersionSegment(baseUrl.slice(versionStart + 1, versionEnd))
	) {
		return `${baseUrl.slice(0, versionStart)}/v4/ai`;
	}

	return `${baseUrl}/v4/ai`;
}

const OFFICIAL_ANTHROPIC_ORIGIN = "https://api.anthropic.com";

/**
 * Whether a base URL targets Anthropic's own Claude API rather than a gateway
 * or proxy that serves Claude models (Azure AI Foundry, corporate gateways).
 * An unset URL means the provider default, which is the official endpoint.
 * Malformed URLs are treated as custom so official-only options stay off.
 */
export function isOfficialAnthropicEndpoint(
	baseUrl: string | undefined,
): boolean {
	if (!baseUrl) {
		return true;
	}
	try {
		return new URL(baseUrl).origin === OFFICIAL_ANTHROPIC_ORIGIN;
	} catch {
		return false;
	}
}
