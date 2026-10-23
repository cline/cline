import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../http";
import { CloudGitHubGateway } from "./CloudGitHubGateway";

const API = "https://api.example.test";
const GITHUB_URL =
	"https://github.com/apps/cline/installations/new?state=signed";

function redirect(location = GITHUB_URL): Response {
	return new Response(null, { status: 302, headers: { Location: location } });
}

function integrations(...providers: string[]): Response {
	return Response.json({
		success: true,
		data: providers.map((provider) => ({ provider })),
	});
}

function gateway(
	fetchImpl: FetchLike,
	getAccessToken: () => Promise<string | null> = async () => "token",
) {
	return new CloudGitHubGateway({ apiBaseUrl: API, getAccessToken, fetchImpl });
}

describe("CloudGitHubGateway.resolveInstallUrl", () => {
	it.each([
		"token",
		"workos:token",
	])("returns the validated personal GitHub redirect using credential %s", async (token) => {
		const fetch = vi.fn<FetchLike>(async () => redirect());
		await expect(
			gateway(fetch, async () => token).resolveInstallUrl(),
		).resolves.toBe(GITHUB_URL);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			`${API}/api/v1/integrations/github/install`,
			expect.objectContaining({
				method: "GET",
				redirect: "manual",
				headers: { Authorization: "Bearer workos:token" },
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("uses org connect for members when a GitHub provider is listed", async () => {
		const fetch = vi
			.fn<FetchLike>()
			.mockResolvedValueOnce(integrations("linear", "github"))
			.mockResolvedValueOnce(redirect());
		await expect(gateway(fetch).resolveInstallUrl("org/team")).resolves.toBe(
			GITHUB_URL,
		);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			`${API}/api/v1/organizations/org%2Fteam/integrations`,
			`${API}/api/v1/organizations/org%2Fteam/integrations/github/connect`,
		]);
		for (const [, init] of fetch.mock.calls) {
			expect(init?.headers).toEqual({ Authorization: "Bearer workos:token" });
			expect(init?.redirect).toBe("manual");
		}
	});

	it("requests the admin-only org install route when no GitHub provider exists", async () => {
		const fetch = vi
			.fn<FetchLike>()
			.mockResolvedValueOnce(integrations("linear"))
			.mockResolvedValueOnce(redirect());
		await gateway(fetch).resolveInstallUrl("org-1");
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			`${API}/api/v1/organizations/org-1/integrations`,
			`${API}/api/v1/organizations/org-1/integrations/github/install`,
		]);
	});

	it("uses the action-specific add-repositories route without an integration lookup", async () => {
		const fetch = vi.fn<FetchLike>(async () => redirect());
		await gateway(fetch).resolveInstallUrl("org-1", "add-repositories");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			`${API}/api/v1/organizations/org-1/integrations/github/add-repositories`,
		);
	});

	it("uses the personal add-repositories route", async () => {
		const fetch = vi.fn<FetchLike>(async () => redirect());
		await gateway(fetch).resolveInstallUrl(undefined, "add-repositories");
		expect(fetch.mock.calls[0]?.[0]).toBe(
			`${API}/api/v1/integrations/github/add-repositories`,
		);
	});

	it("does not make a request when the user has no Cloud token", async () => {
		const fetch = vi.fn<FetchLike>();
		await expect(
			gateway(fetch, async () => null).resolveInstallUrl(),
		).rejects.toMatchObject({ status: 401 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("explains the admin requirement when the server rejects an org install", async () => {
		const fetch = vi
			.fn<FetchLike>()
			.mockResolvedValueOnce(integrations())
			.mockResolvedValueOnce(
				Response.json(
					{ success: false, error: "organization admin role required" },
					{ status: 403 },
				),
			);
		await expect(
			gateway(fetch).resolveInstallUrl("org-1"),
		).rejects.toMatchObject({
			name: "CloudGitHubApiError",
			status: 403,
			message: expect.stringContaining(
				"Only an organization admin can install the Cline GitHub App",
			),
		});
	});

	it.each([
		"http://github.com/apps/cline/installations/new?state=signed",
		"https://github.com.attacker.example/apps/cline/installations/new",
		"https://attacker@github.com/apps/cline/installations/new",
		"https://github.com:444/apps/cline/installations/new",
		"/apps/cline/installations/new?state=signed",
	])("rejects an unsafe redirect URL: %s", async (location) => {
		const fetch = vi.fn<FetchLike>(async () => redirect(location));
		await expect(gateway(fetch).resolveInstallUrl()).rejects.toThrow(
			"GitHub connection URL",
		);
	});

	it("rejects unexpected success responses rather than following or guessing", async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			Response.json({ success: true }),
		);
		await expect(gateway(fetch).resolveInstallUrl()).rejects.toMatchObject({
			name: "CloudGitHubApiError",
			status: 200,
		});
	});

	it("surfaces an unreadable org integration list instead of choosing install", async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			Response.json({ success: true, data: "invalid" }),
		);
		await expect(gateway(fetch).resolveInstallUrl("org-1")).rejects.toThrow(
			"organization integrations this app could not read",
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("preserves API errors outside the GitHub redirect response", async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			Response.json(
				{ success: false, error: "authentication required" },
				{ status: 401 },
			),
		);
		await expect(gateway(fetch).resolveInstallUrl()).rejects.toMatchObject({
			name: "CloudGitHubApiError",
			status: 401,
			message: "authentication required",
		});
	});
});
