import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isClineAccountNotAuthenticatedResult } from "../webview/lib/cline-account-state";
import {
	listClineGitHubRepositories,
	listClineIntegrations,
	resolveGitHubInstallUrl,
} from "./commands-integrations";
import type { SidecarContext } from "./types";

const getProviderSettingsMock = vi.hoisted(() => vi.fn());
const resolveProviderApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getProviderSettings = getProviderSettingsMock;
		},
		RuntimeOAuthTokenManager: class {
			resolveProviderApiKey = resolveProviderApiKeyMock;
		},
	};
});

function createContext() {
	const capture = vi.fn();
	const ctx = {
		telemetry: { capture },
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
	return { ctx, capture };
}

const REQUEST_OPTIONS = {
	apiBaseUrl: "https://api.example.com",
	appBaseUrl: "https://app.example.com",
	authToken: "test-token",
} as const;

function requestOptions(fetchImpl: ReturnType<typeof vi.fn>) {
	return {
		...REQUEST_OPTIONS,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	getProviderSettingsMock.mockReset();
	resolveProviderApiKeyMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("listClineIntegrations", () => {
	it("lists integrations through the envelope with a bearer token", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: [{ provider: "github" }] }),
			);

		const result = await listClineIntegrations(requestOptions(fetchImpl));

		expect(result).toEqual([{ provider: "github" }]);
		const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
		expect(String(url)).toBe("https://api.example.com/api/v1/integrations");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-token",
		);
	});
});

describe("listClineGitHubRepositories", () => {
	it("lists GitHub repositories from the repositories endpoint", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: [{ full_name: "cline/cline" }] }),
			);

		const result = await listClineGitHubRepositories(requestOptions(fetchImpl));

		expect(result).toEqual([{ full_name: "cline/cline" }]);
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			"https://api.example.com/api/v1/integrations/github/repositories",
		);
	});

	it("surfaces the API envelope error message on failures", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse(
					{ success: false, error: "failed to list integrations" },
					500,
				),
			);

		await expect(
			listClineIntegrations(requestOptions(fetchImpl)),
		).rejects.toThrow("failed to list integrations");
	});
});

describe("resolveGitHubInstallUrl", () => {
	it("resolves the GitHub install URL from the redirect location", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: {
					location: "https://github.com/apps/cline/installations/new?state=abc",
				},
			}),
		);

		const result = await resolveGitHubInstallUrl(requestOptions(fetchImpl));

		expect(result).toEqual({
			url: "https://github.com/apps/cline/installations/new?state=abc",
		});
		const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
		expect(url.origin + url.pathname).toBe(
			"https://api.example.com/api/v1/integrations/github/install",
		);
		// The post-install browser hop must land on the Cline dashboard.
		expect(url.searchParams.get("redirect")).toBe(
			"https://app.example.com/dashboard/integrations",
		);
		// The redirect must be read, not followed: the Location URL is the result.
		expect(init.redirect).toBe("manual");
	});

	it("resolves a relative redirect location against the request URL", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "//github.com/apps/cline/installations/new" },
			}),
		);

		const result = await resolveGitHubInstallUrl(requestOptions(fetchImpl));

		// A bare relative Location would blow up later in the URL opener.
		expect(result).toEqual({
			url: "https://github.com/apps/cline/installations/new",
		});
	});

	it.each([
		["https://evil.example/apps/cline", "evil.example"],
		["https://github.com.evil.example/apps/cline", "github.com.evil.example"],
		// Subdomains are not part of the install flow, so they are not allowed
		// either -- the host must be exactly github.com.
		["https://gist.github.com/apps/cline", "gist.github.com"],
	])("rejects a redirect to a non-GitHub host (%s)", async (location, host) => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				new Response(null, { status: 302, headers: { location } }),
			);

		await expect(
			resolveGitHubInstallUrl(requestOptions(fetchImpl)),
		).rejects.toThrow(`unexpected host: ${host}`);
	});

	it("rejects a redirect that does not use https", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "http://github.com/apps/cline" },
			}),
		);

		await expect(
			resolveGitHubInstallUrl(requestOptions(fetchImpl)),
		).rejects.toThrow("must use https");
	});

	it("rejects a redirect location that is not a usable URL", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "http://" },
			}),
		);

		await expect(
			resolveGitHubInstallUrl(requestOptions(fetchImpl)),
		).rejects.toThrow("not a valid URL");
	});

	it("throws when the install endpoint does not answer with a redirect", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ error: "authentication required" }, 401),
			);

		await expect(
			resolveGitHubInstallUrl(requestOptions(fetchImpl)),
		).rejects.toThrow("authentication required");
	});
});

describe("cline_integrations command auth states", () => {
	it("returns a typed not-authenticated result when signed out, without calling the API", async () => {
		const { ctx, capture } = createContext();
		resolveProviderApiKeyMock.mockResolvedValue(null);
		getProviderSettingsMock.mockReturnValue(undefined);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { handleCommand } = await import("./commands");
		const result = await handleCommand(ctx, "cline_integrations", {
			operation: "list",
		});

		expect(isClineAccountNotAuthenticatedResult(result)).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(capture).not.toHaveBeenCalled();
	});

	it("calls the Cline API with the resolved fresh token when signed in", async () => {
		const { ctx } = createContext();
		resolveProviderApiKeyMock.mockResolvedValue({
			apiKey: "fresh-token",
			refreshed: true,
		});
		getProviderSettingsMock.mockReturnValue(undefined);
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: [{ provider: "github" }] }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const { handleCommand } = await import("./commands");
		const result = await handleCommand(ctx, "cline_integrations", {
			operation: "list",
		});

		expect(result).toEqual([{ provider: "github" }]);
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		expect(String(url)).toContain("/api/v1/integrations");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer fresh-token",
		);
	});

	it("rejects unknown operations", async () => {
		const { ctx } = createContext();
		resolveProviderApiKeyMock.mockResolvedValue({
			apiKey: "fresh-token",
			refreshed: true,
		});
		getProviderSettingsMock.mockReturnValue(undefined);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { handleCommand } = await import("./commands");
		await expect(
			handleCommand(ctx, "cline_integrations", {
				operation: "dropIntegrations",
			}),
		).rejects.toThrow("Unsupported Cline integrations operation");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
