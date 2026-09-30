import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	createComposioToolsExtension,
	resolveComposioToolsStatePath,
} from "./composio-tools-extension";

// Keep storage, token manager, provider handler, and connector auth real. Only
// external HTTP responses and the rollout flag are controlled by this suite.
vi.mock("../../services/feature-flags/cline-account-feature-flags", () => ({
	isClineAccountFeatureEnabled: async () => true,
}));

const API = "https://api.cline.test";
const refreshedAuth = {
	accessToken: "new-access",
	refreshToken: "new-refresh",
	expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	tokenType: "Bearer",
	userInfo: {
		clineUserId: "account-a",
		email: "fixture@example.test",
		subject: null,
		name: "Fixture",
		accounts: [],
	},
};
let directory: string;
let settings: ProviderSettingsManager;
let execute: (input: unknown) => Promise<unknown>;
const http = vi.fn<typeof fetch>();

function saveAccount(accountId = "account-a", expiresAt = Date.now() - 60_000) {
	settings.saveProviderSettings({
		provider: "cline",
		baseUrl: API,
		auth: {
			accountId,
			accessToken: "old-access",
			refreshToken: "old-refresh",
			expiresAt,
		},
	});
}

function stubResponses(refresh: () => Promise<Response>, executeStatus = 200) {
	http.mockImplementation(async (url) => {
		if (String(url) === `${API}/api/v1/auth/refresh`) return refresh();
		expect(String(url)).toBe(
			`${API}/api/v1/connectors/tools/READ_FIXTURE/execute`,
		);
		return Response.json(
			executeStatus === 200 ? { successful: true } : { error: "expired token" },
			{ status: executeStatus },
		);
	});
}

function executionCalls() {
	return http.mock.calls.filter(([url]) => String(url).endsWith("/execute"));
}

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), "composio-local-auth-"));
	vi.stubEnv("CLINE_DIR", join(directory, "cline"));
	vi.stubEnv("CLINE_DATA_DIR", join(directory, "data"));
	settings = new ProviderSettingsManager();
	const path = resolveComposioToolsStatePath("account-a");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify({
			toolkits: {
				fixture: {
					connectedAccountId: "fixture",
					tools: [{ slug: "READ_FIXTURE" }],
				},
			},
		}),
	);
});
beforeEach(async () => {
	http.mockReset();
	vi.stubGlobal("fetch", http);
	saveAccount();
	const extension = await createComposioToolsExtension();
	expect(extension).toBeDefined();
	await extension?.setup?.(
		{
			registerTool: (tool: { execute: typeof execute }) => {
				execute = tool.execute;
			},
		} as never,
		{} as never,
	);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

describe("local connector execution through real auth", () => {
	it("refreshes expired credentials, persists the rotation and sends the refreshed bearer", async () => {
		stubResponses(async () =>
			Response.json({ success: true, data: refreshedAuth }),
		);
		expect(await execute({})).toEqual({ successful: true });
		expect(http).toHaveBeenCalledTimes(2);
		expect(JSON.parse(http.mock.calls[0][1]?.body as string)).toEqual({
			refreshToken: "old-refresh",
			grantType: "refresh_token",
		});
		expect(
			new Headers(executionCalls()[0][1]?.headers).get("authorization"),
		).toBe("Bearer workos:new-access");
		expect(settings.getProviderSettings("cline")?.auth?.refreshToken).toBe(
			"new-refresh",
		);
	});

	it.each([
		200, 401,
	])("formats persisted fallback after refresh failure and preserves execution HTTP %i", async (status) => {
		stubResponses(
			async () =>
				Response.json({ error: "temporarily unavailable" }, { status: 503 }),
			status,
		);
		const result = await execute({});
		expect(
			new Headers(executionCalls()[0][1]?.headers).get("authorization"),
		).toBe("Bearer workos:old-access");
		expect(settings.getProviderSettings("cline")?.auth?.refreshToken).toBe(
			"old-refresh",
		);
		expect(executionCalls()).toHaveLength(1);
		expect(result).toEqual(
			status === 200
				? { successful: true }
				: { successful: false, error: expect.stringContaining("HTTP 401") },
		);
	});

	it("does not send the saved token when refresh is definitively rejected", async () => {
		stubResponses(async () =>
			Response.json({ error: "invalid_grant" }, { status: 400 }),
		);
		expect(await execute({})).toMatchObject({
			successful: false,
			error: expect.stringContaining("Sign in"),
		});
		expect(http).toHaveBeenCalledOnce();
		expect(executionCalls()).toHaveLength(0);
	});

	it.each([
		"sign out",
		"switch accounts",
	])("does not execute or restore old credentials after %s during refresh", async (change) => {
		stubResponses(async () => {
			if (change === "sign out")
				settings.saveProviderSettings({
					provider: "cline",
					baseUrl: API,
					auth: {},
				});
			else saveAccount("account-b");
			return Response.json({ success: true, data: refreshedAuth });
		});
		expect(await execute({})).toMatchObject({ successful: false });
		expect(executionCalls()).toHaveLength(0);
		expect(settings.getProviderSettings("cline")?.auth?.accountId).toBe(
			change === "sign out" ? undefined : "account-b",
		);
	});
});
