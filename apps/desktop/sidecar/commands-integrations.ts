import type {
	ClineGitHubRepository,
	ClineIntegration,
} from "../webview/lib/cline-integrations-types";

const DEFAULT_TIMEOUT_MS = 30_000;

const GITHUB_INSTALL_HOST = "github.com";

function resolveInstallRedirect(location: string, requestUrl: URL): string {
	let resolved: URL;
	try {
		resolved = new URL(location, requestUrl);
	} catch {
		throw new Error(`GitHub install redirect is not a valid URL: ${location}`);
	}
	if (resolved.protocol !== "https:") {
		throw new Error(
			`GitHub install redirect must use https, got: ${resolved.protocol}`,
		);
	}
	if (resolved.hostname !== GITHUB_INSTALL_HOST) {
		throw new Error(
			`GitHub install redirect pointed at an unexpected host: ${resolved.hostname}`,
		);
	}
	return resolved.toString();
}

export interface ClineIntegrationsRequestOptions {
	apiBaseUrl: string;
	/** Frontend origin the browser install flow returns to when it finishes. */
	appBaseUrl: string;
	authToken: string;
	requestTimeoutMs?: number;
	fetchImpl?: typeof fetch;
}

export async function listClineIntegrations(
	options: ClineIntegrationsRequestOptions,
): Promise<ClineIntegration[]> {
	const data = await requestClineApiJson("/api/v1/integrations", options);
	return Array.isArray(data) ? (data as ClineIntegration[]) : [];
}

export async function listClineGitHubRepositories(
	options: ClineIntegrationsRequestOptions,
): Promise<ClineGitHubRepository[]> {
	const data = await requestClineApiJson(
		"/api/v1/integrations/github/repositories",
		options,
	);
	return Array.isArray(data) ? (data as ClineGitHubRepository[]) : [];
}

export async function resolveGitHubInstallUrl(
	options: ClineIntegrationsRequestOptions,
): Promise<{ url: string }> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const installUrl = new URL(
		"/api/v1/integrations/github/install",
		options.apiBaseUrl,
	);
	installUrl.searchParams.set(
		"redirect",
		new URL("/dashboard/integrations", options.appBaseUrl).toString(),
	);

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	try {
		const response = await fetchImpl(installUrl, {
			method: "GET",
			headers: { Authorization: `Bearer ${options.authToken}` },
			redirect: "manual",
			signal: controller.signal,
		});

		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location?.trim()) {
			return { url: resolveInstallRedirect(location.trim(), installUrl) };
		}

		const text = await response.text().catch(() => "");
		let parsed: unknown;
		try {
			parsed = text.trim() ? JSON.parse(text) : undefined;
		} catch {
			parsed = undefined;
		}
		throw new Error(formatRequestFailure(response.status, text, parsed));
	} finally {
		clearTimeout(timeout);
	}
}

function getEnvelopeError(parsed: unknown): string | undefined {
	if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) {
		return undefined;
	}
	const error = (parsed as { error?: unknown }).error;
	return typeof error === "string" && error.trim() ? error : undefined;
}

function formatRequestFailure(
	status: number,
	bodyText: string,
	parsed: unknown,
): string {
	const envelopeError = getEnvelopeError(parsed);
	if (envelopeError) {
		return envelopeError;
	}
	const body = bodyText.trim();
	if (body) {
		const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body;
		return `Cline integrations request failed with status ${status}: ${preview}`;
	}
	return `Cline integrations request failed with status ${status}`;
}

async function requestClineApiJson(
	endpoint: string,
	options: ClineIntegrationsRequestOptions,
): Promise<unknown> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	try {
		const response = await fetchImpl(new URL(endpoint, options.apiBaseUrl), {
			method: "GET",
			headers: {
				Authorization: `Bearer ${options.authToken}`,
				"Content-Type": "application/json",
			},
			signal: controller.signal,
		});

		const text = await response.text();
		let parsed: unknown;
		if (text.trim()) {
			try {
				parsed = JSON.parse(text);
			} catch {
				if (!response.ok) {
					throw new Error(
						formatRequestFailure(response.status, text, undefined),
					);
				}
				throw new Error("Cline integrations response was not valid JSON");
			}
		}

		if (!response.ok) {
			throw new Error(formatRequestFailure(response.status, text, parsed));
		}

		if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
			const envelope = parsed as {
				success?: unknown;
				error?: unknown;
				data?: unknown;
			};
			if (typeof envelope.success === "boolean") {
				if (!envelope.success) {
					throw new Error(
						getEnvelopeError(parsed) || "Cline integrations request failed",
					);
				}
				return envelope.data ?? null;
			}
		}
		return parsed ?? null;
	} finally {
		clearTimeout(timeout);
	}
}
