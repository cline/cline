import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubCloudSessionClient } from "@cline/core/cloud";
import {
	CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
	isClineAccountNotAuthenticatedResult,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const accountActionMock = vi.hoisted(() => vi.fn());
const getProviderSettingsMock = vi.hoisted(() => vi.fn());
const saveProviderSettingsMock = vi.hoisted(() => vi.fn());
const persistProviderSettingsMock = vi.hoisted(() => vi.fn());
const runProviderOAuthLoginMock = vi.hoisted(() => vi.fn());
let testDataDir: string;

vi.mock("./oauth-login", () => ({
	runProviderOAuthLogin: runProviderOAuthLoginMock,
	cancelProviderOAuthLogin: vi.fn(),
}));

vi.mock("./context", async () => ({
	...(await vi.importActual<typeof import("./context")>("./context")),
	ensureSharedHubClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		createHubProviderAuthApi: () => ({ account: accountActionMock }),
		ProviderSettingsManager: class {
			getProviderSettings = getProviderSettingsMock;
			saveProviderSettings = persistProviderSettingsMock;
		},
		createHubProvidersApi: () => ({ saveSettings: saveProviderSettingsMock }),
	};
});

function createContext() {
	const capture = vi.fn();
	const setDistinctId = vi.fn();
	const updateCommonProperties = vi.fn();
	const ctx = {
		telemetry: { capture, setDistinctId, updateCommonProperties },
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
		wsClients: new Set(),
		liveSessions: new Map(),
	} as unknown as SidecarContext;
	return { ctx, capture, setDistinctId, updateCommonProperties };
}

const FETCH_ME_ARGS = {
	action: "clineAccount",
	operation: "fetchMe",
} as const;

async function runClineAccountCommand(ctx: SidecarContext) {
	const { handleCommand } = await import("./commands");
	return handleCommand(ctx, "cline_account", { ...FETCH_ME_ARGS });
}

beforeEach(() => {
	vi.spyOn(
		HubCloudSessionClient.prototype,
		"refreshOrganization",
	).mockResolvedValue(undefined);
	// Account context is persisted across launches; never hydrate the developer's
	// signed-in identity when a test expects an anonymous device identity.
	testDataDir = mkdtempSync(join(tmpdir(), "commands-account-test-"));
	vi.stubEnv("CLINE_DATA_DIR", testDataDir);
	vi.stubEnv("CLINE_DIR", testDataDir);
	accountActionMock.mockReset();
	getProviderSettingsMock.mockReset();
	saveProviderSettingsMock.mockReset();
	persistProviderSettingsMock.mockReset();
	runProviderOAuthLoginMock
		.mockReset()
		.mockResolvedValue({ accessToken: "token" });
});

describe("provider settings cloud session lifecycle", () => {
	it.each([
		["cline", false, true],
		["cline-pass", false, true],
		["openai-codex", false, false],
		["cline-pass", true, false],
	] as const)("handles %s login (failed: %s, resets cloud: %s)", async (provider, failed, resets) => {
		const { ctx } = createContext();
		const dispose = vi.fn().mockResolvedValue(undefined);
		const cloudManager = { dispose } as unknown as NonNullable<
			SidecarContext["cloudSessionManager"]
		>;
		ctx.cloudSessionManager = cloudManager;
		const send = vi.fn();
		ctx.wsClients.add({ send });
		if (failed)
			runProviderOAuthLoginMock.mockRejectedValueOnce(
				new Error("login failed"),
			);
		const { handleCommand } = await import("./commands");
		const login = handleCommand(ctx, "run_provider_oauth_login", { provider });
		if (failed) await expect(login).rejects.toThrow("login failed");
		else await expect(login).resolves.toEqual({ accessToken: "token" });
		expect(ctx.cloudSessionManager).toBe(resets ? null : cloudManager);
		expect(dispose).toHaveBeenCalledTimes(resets ? 1 : 0);
		expect(send.mock.calls.map(([raw]) => JSON.parse(raw).event)).toEqual(
			resets
				? [
						{
							name: "cloud_sessions_changed",
							payload: { environmentId: "local" },
						},
					]
				: [],
		);
	});

	it.each([
		{ enabled: true },
		{ base_url: "https://api.example.test" },
	])("preserves the cloud manager for ordinary settings %j", async (update) => {
		const { ctx } = createContext();
		const dispose = vi.fn();
		const cloudManager = { dispose } as unknown as NonNullable<
			SidecarContext["cloudSessionManager"]
		>;
		ctx.cloudSessionManager = cloudManager;
		getProviderSettingsMock.mockReturnValue({
			auth: { accessToken: "token", accountId: "acct-1" },
		});
		saveProviderSettingsMock.mockImplementation(() => {
			// Saving creates a fresh settings object even when auth is unchanged.
			getProviderSettingsMock.mockReturnValue({
				...update,
				auth: { accessToken: "token", accountId: "acct-1" },
			});
			return {
				providerId: "cline",
				enabled: true,
				clineCredentialsChanged: false,
			};
		});
		const { handleCommand } = await import("./commands");
		await handleCommand(ctx, "save_provider_settings", {
			provider: "cline",
			...update,
		});
		expect(ctx.cloudSessionManager).toBe(cloudManager);
		expect(dispose).not.toHaveBeenCalled();
	});

	it.each([
		{ api_key: "", settings: { auth: { accessToken: "", accountId: "" } } },
		{ api_key: "replacement-key" },
		{ settings: { auth: { accessToken: "new-token", accountId: "acct-2" } } },
		{ enabled: false },
	])("resets the cloud manager when credentials change: %j", async (update) => {
		const { ctx } = createContext();
		const send = vi.fn();
		ctx.wsClients.add({ send });
		const dispose = vi.fn().mockResolvedValue(undefined);
		ctx.cloudSessionManager = { dispose } as unknown as NonNullable<
			SidecarContext["cloudSessionManager"]
		>;
		getProviderSettingsMock.mockReturnValue({
			apiKey: "old-key",
			auth: { accessToken: "token", accountId: "acct-1" },
		});
		saveProviderSettingsMock.mockImplementation(() => {
			getProviderSettingsMock.mockReturnValue(
				update.enabled === false
					? undefined
					: {
							apiKey: update.api_key ?? "old-key",
							auth: update.settings?.auth ?? {
								accessToken: "token",
								accountId: "acct-1",
							},
						},
			);
			return {
				providerId: "cline",
				enabled: update.enabled !== false,
				clineCredentialsChanged: true,
			};
		});
		const { handleCommand } = await import("./commands");
		await handleCommand(ctx, "save_provider_settings", {
			provider: "cline",
			...update,
		});
		expect(
			send.mock.calls.map(([message]) => JSON.parse(message).event.name),
		).toEqual(["cloud_sessions_changed"]);
		expect(ctx.cloudSessionManager).toBeNull();
		expect(dispose).toHaveBeenCalledOnce();
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(testDataDir, { recursive: true, force: true });
});

describe("cline_account Hub forwarding", () => {
	it("restores anonymous telemetry for the Hub's signed-out result", async () => {
		const { ctx, capture, setDistinctId } = createContext();
		accountActionMock.mockResolvedValue(CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT);
		expect(
			isClineAccountNotAuthenticatedResult(await runClineAccountCommand(ctx)),
		).toBe(true);
		expect(capture).not.toHaveBeenCalled();
		expect(setDistinctId).toHaveBeenCalledWith(expect.any(String));
	});
	it("forwards account actions to the Hub and returns the result", async () => {
		const { ctx } = createContext();
		const user = { id: "account-1" };
		accountActionMock.mockResolvedValue(user);
		expect(await runClineAccountCommand(ctx)).toBe(user);
		expect(accountActionMock).toHaveBeenCalledWith(FETCH_ME_ARGS);
	});
	it("surfaces Hub failures without making a local account request", async () => {
		const { ctx } = createContext();
		accountActionMock.mockRejectedValue(
			new Error("Hub account request failed"),
		);
		await expect(runClineAccountCommand(ctx)).rejects.toThrow(
			"Hub account request failed",
		);
	});
});

/**
 * Feature-flag identity is otherwise resolved once at sidecar startup, so these
 * cover the mid-session transitions that would otherwise keep evaluating flags
 * against a stale account (or the device).
 */
describe("cline_account keeps feature-flag identity in sync", () => {
	it.each([
		"Hub unavailable",
		"organization request failed",
		"cloud disabled",
	])("keeps a successful account switch and desktop cleanup when %s", async (failure) => {
		vi.stubEnv(
			"CLINE_CODE_CLOUD_AGENTS",
			failure === "cloud disabled" ? "0" : "1",
		);
		const { getCloudSessionManager } = await import("./cloud-sessions");
		const { ctx } = createContext();
		const viewer = getCloudSessionManager(ctx);
		const dispose = vi.spyOn(viewer, "dispose");
		const send = vi.fn();
		ctx.wsClients.add({ send } as never);

		getProviderSettingsMock.mockReturnValue({});
		const result = { switched: true };
		accountActionMock.mockResolvedValue(result);
		vi.mocked(
			HubCloudSessionClient.prototype.refreshOrganization,
		).mockRejectedValue(new Error(failure));
		await expect(runOperation(ctx, "switchAccount")).resolves.toBe(result);
		expect(dispose).toHaveBeenCalledOnce();
		expect(ctx.cloudSessionManager).not.toBe(viewer);
		expect(
			send.mock.calls.map(([message]) => JSON.parse(message).event.name),
		).toContain("cloud_sessions_changed");
		if (failure === "cloud disabled")
			expect(
				HubCloudSessionClient.prototype.refreshOrganization,
			).not.toHaveBeenCalled();
		else {
			expect(
				HubCloudSessionClient.prototype.refreshOrganization,
			).toHaveBeenCalledOnce();
			expect(send).toHaveBeenCalledBefore(
				vi.mocked(HubCloudSessionClient.prototype.refreshOrganization),
			);
		}
	});

	async function currentFlagsUserId(): Promise<string | undefined> {
		const { getDesktopFeatureFlagsContext } = await import("./feature-flags");
		return getDesktopFeatureFlagsContext().userId ?? undefined;
	}

	async function runOperation(ctx: SidecarContext, operation: string) {
		const { handleCommand } = await import("./commands");
		return handleCommand(ctx, "cline_account", {
			action: "clineAccount",
			operation,
		});
	}

	beforeEach(async () => {
		const { resetDesktopFeatureFlagsForTesting } = await import(
			"./feature-flags"
		);
		resetDesktopFeatureFlagsForTesting();
	});

	it("adopts the account identity on login", async () => {
		const { ctx, setDistinctId, updateCommonProperties } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({
			id: "acct-1",
			email: "dev@example.com",
		});

		await runOperation(ctx, "fetchMe");

		expect(await currentFlagsUserId()).toBe("acct-1");
		expect(setDistinctId).toHaveBeenCalledWith("acct-1");
		expect(updateCommonProperties).toHaveBeenCalledWith(
			expect.objectContaining({ user_id: "acct-1", account_id: "acct-1" }),
		);
		expect(ctx.telemetryUser).toEqual({
			distinctId: "acct-1",
			accountId: "acct-1",
			email: "dev@example.com",
			organizationId: undefined,
		});
	});

	it("applies and persists the active organization for task telemetry", async () => {
		const { ctx, updateCommonProperties } = createContext();

		getProviderSettingsMock.mockReturnValue({
			provider: "cline",
			auth: { accountId: "acct-1", accessToken: "token" },
		});
		accountActionMock.mockResolvedValue({
			id: "acct-1",
			email: "dev@example.com",
			organizations: [
				{
					active: true,
					memberId: "member-1",
					name: "Acme",
					organizationId: "org-1",
					roles: ["member"],
				},
			],
		});

		await runOperation(ctx, "fetchMe");

		expect(updateCommonProperties).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: "acct-1",
				organization_id: "org-1",
			}),
		);
		expect(persistProviderSettingsMock).not.toHaveBeenCalled();
		expect(ctx.telemetryUser).toEqual({
			distinctId: "acct-1",
			accountId: "acct-1",
			email: "dev@example.com",
			organizationId: "org-1",
		});
	});

	it("leaves the signed-in identity intact across an organization switch", async () => {
		vi.stubEnv("CLINE_CODE_CLOUD_AGENTS", "1");
		const { ctx } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");
		expect(await currentFlagsUserId()).toBe("acct-1");

		accountActionMock.mockResolvedValue(undefined);
		getProviderSettingsMock.mockReturnValue({
			auth: { accountId: "stale-acct" },
		});

		await runOperation(ctx, "switchAccount");
		expect(
			HubCloudSessionClient.prototype.refreshOrganization,
		).toHaveBeenCalledOnce();

		expect(await currentFlagsUserId()).toBe("acct-1");
	});

	it("adopts the identity from the refetch that follows a switch", async () => {
		const { ctx } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");

		accountActionMock.mockResolvedValue(undefined);
		await runOperation(ctx, "switchAccount");

		accountActionMock.mockResolvedValue({ id: "acct-2" });
		await runOperation(ctx, "fetchMe");

		expect(await currentFlagsUserId()).toBe("acct-2");
	});

	it("clears the account identity on logout", async () => {
		const { ctx, setDistinctId, updateCommonProperties } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");
		expect(await currentFlagsUserId()).toBe("acct-1");

		// Signed out: no token resolves.
		accountActionMock.mockResolvedValue(CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT);
		getProviderSettingsMock.mockReturnValue(undefined);

		await runOperation(ctx, "fetchMe");

		expect(await currentFlagsUserId()).toBeUndefined();
		expect(ctx.telemetryUser).toEqual(
			expect.objectContaining({
				accountId: null,
				distinctId: expect.any(String),
			}),
		);
		expect(setDistinctId).toHaveBeenLastCalledWith(
			ctx.telemetryUser?.distinctId,
		);
		expect(ctx.telemetryUser?.distinctId).not.toBe("acct-1");
		expect(updateCommonProperties).toHaveBeenLastCalledWith(
			expect.objectContaining({
				user_id: undefined,
				account_id: undefined,
				account_email: undefined,
				organization_id: undefined,
			}),
		);
	});

	it("clears the identity when sign-out blanks the cline auth settings", async () => {
		const { ctx, setDistinctId, updateCommonProperties } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");
		expect(await currentFlagsUserId()).toBe("acct-1");

		// What the Sign Out button actually sends: a settings write that blanks
		// the auth block. No account command is involved.
		getProviderSettingsMock.mockReturnValue({ auth: { accountId: "" } });
		saveProviderSettingsMock.mockReturnValue({
			providerId: "cline",
			enabled: true,
			settingsPath: "/tmp/settings.json",
		});
		const { handleCommand } = await import("./commands");
		await handleCommand(ctx, "save_provider_settings", {
			provider: "cline",
			api_key: "",
			settings: { auth: { accessToken: "", refreshToken: "", accountId: "" } },
		});

		expect(await currentFlagsUserId()).toBeUndefined();
		expect(ctx.telemetryUser).toEqual(
			expect.objectContaining({
				accountId: null,
				distinctId: expect.any(String),
			}),
		);
		expect(setDistinctId).toHaveBeenLastCalledWith(
			ctx.telemetryUser?.distinctId,
		);
		expect(updateCommonProperties).toHaveBeenLastCalledWith(
			expect.objectContaining({
				user_id: undefined,
				account_id: undefined,
				organization_id: undefined,
			}),
		);
	});

	it("forwards Cline Pass sign-out to the hub and updates the cloud view", async () => {
		const { ctx } = createContext();
		const dispose = vi.fn().mockResolvedValue(undefined);
		ctx.cloudSessionManager = { dispose } as unknown as NonNullable<
			SidecarContext["cloudSessionManager"]
		>;
		getProviderSettingsMock.mockReturnValue(undefined);
		saveProviderSettingsMock.mockResolvedValue({
			providerId: "cline-pass",
			enabled: false,
			settingsPath: "/tmp/settings.json",
			clineCredentialsChanged: true,
		});
		const { handleCommand } = await import("./commands");
		await handleCommand(ctx, "save_provider_settings", {
			provider: "cline-pass",
			enabled: false,
		});
		expect(saveProviderSettingsMock).toHaveBeenCalledOnce();
		expect(saveProviderSettingsMock).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "cline-pass", enabled: false }),
		);
		expect(dispose).toHaveBeenCalledOnce();
		expect(ctx.cloudSessionManager).toBeNull();
	});

	it("ignores settings writes for other providers", async () => {
		const { ctx } = createContext();

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");

		saveProviderSettingsMock.mockReturnValue({
			providerId: "anthropic",
			enabled: true,
			settingsPath: "/tmp/settings.json",
		});
		const { handleCommand } = await import("./commands");
		await handleCommand(ctx, "save_provider_settings", {
			provider: "anthropic",
			api_key: "sk-test",
		});

		// Saving an unrelated provider must not disturb the Cline identity.
		expect(await currentFlagsUserId()).toBe("acct-1");
	});

	it("falls back to the device distinct ID after logout", async () => {
		const { ctx } = createContext();
		const { getDesktopFeatureFlagsContext } = await import("./feature-flags");
		const deviceId = getDesktopFeatureFlagsContext().distinctId;

		getProviderSettingsMock.mockReturnValue({});
		accountActionMock.mockResolvedValue({ id: "acct-1" });
		await runOperation(ctx, "fetchMe");
		expect(getDesktopFeatureFlagsContext().distinctId).toBe("acct-1");

		accountActionMock.mockResolvedValue(CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT);
		getProviderSettingsMock.mockReturnValue(undefined);
		await runOperation(ctx, "fetchMe");

		// Not left on the previous account's ID.
		expect(getDesktopFeatureFlagsContext().distinctId).toBe(deviceId);
	});
});
