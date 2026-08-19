import { beforeEach, describe, expect, it, vi } from "vitest";
import { isClineAccountNotAuthenticatedResult } from "../webview/lib/cline-account-state";
import type { SidecarContext } from "./types";

const clineAccountServiceCtorMock = vi.hoisted(() => vi.fn());
const executeClineAccountActionMock = vi.hoisted(() => vi.fn());
const getProviderSettingsMock = vi.hoisted(() => vi.fn());
const resolveProviderApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineAccountService: class {
			constructor(options: unknown) {
				clineAccountServiceCtorMock(options);
			}
		},
		executeClineAccountAction: executeClineAccountActionMock,
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

const FETCH_ME_ARGS = {
	action: "clineAccount",
	operation: "fetchMe",
} as const;

async function runClineAccountCommand(ctx: SidecarContext) {
	const { handleCommand } = await import("./commands");
	return handleCommand(ctx, "cline_account", { ...FETCH_ME_ARGS });
}

beforeEach(() => {
	clineAccountServiceCtorMock.mockReset();
	executeClineAccountActionMock.mockReset();
	getProviderSettingsMock.mockReset();
	resolveProviderApiKeyMock.mockReset();
});

describe("cline_account command auth states", () => {
	it("returns a typed not-authenticated result when signed out, without telemetry or a thrown error", async () => {
		const { ctx, capture } = createContext();
		resolveProviderApiKeyMock.mockResolvedValue(null);
		getProviderSettingsMock.mockReturnValue(undefined);

		const result = await runClineAccountCommand(ctx);

		expect(result).toEqual({
			signedIn: false,
			code: "ACCOUNT_NOT_AUTHENTICATED",
		});
		expect(isClineAccountNotAuthenticatedResult(result)).toBe(true);
		expect(executeClineAccountActionMock).not.toHaveBeenCalled();
		expect(clineAccountServiceCtorMock).not.toHaveBeenCalled();
		expect(capture).not.toHaveBeenCalled();
	});

	it("runs the account action unchanged when a fresh token resolves", async () => {
		const { ctx, capture } = createContext();
		resolveProviderApiKeyMock.mockResolvedValue({
			apiKey: "fresh-token",
			refreshed: true,
		});
		getProviderSettingsMock.mockReturnValue(undefined);
		const user = { id: "user-1", email: "beatrix@cline.bot" };
		executeClineAccountActionMock.mockResolvedValue(user);

		const result = await runClineAccountCommand(ctx);

		expect(result).toBe(user);
		expect(executeClineAccountActionMock).toHaveBeenCalledWith(
			expect.objectContaining(FETCH_ME_ARGS),
			expect.anything(),
		);
		const serviceOptions = clineAccountServiceCtorMock.mock.calls[0][0] as {
			getAuthToken: () => Promise<string | undefined>;
		};
		await expect(serviceOptions.getAuthToken()).resolves.toBe("fresh-token");
		expect(capture).not.toHaveBeenCalled();
	});

	it("falls back to the persisted token silently when the refresh fails", async () => {
		const { ctx, capture } = createContext();
		resolveProviderApiKeyMock.mockRejectedValue(
			new Error("Token refresh failed: 500"),
		);
		getProviderSettingsMock.mockReturnValue({
			auth: { accessToken: "persisted-token" },
		});
		executeClineAccountActionMock.mockResolvedValue({ id: "user-1" });

		await runClineAccountCommand(ctx);

		const serviceOptions = clineAccountServiceCtorMock.mock.calls[0][0] as {
			getAuthToken: () => Promise<string | undefined>;
		};
		await expect(serviceOptions.getAuthToken()).resolves.toBe(
			"persisted-token",
		);
		expect(capture).not.toHaveBeenCalled();
	});

	it("reports one auth refresh soft-failure event when the refresh fails and no fallback token exists", async () => {
		const { ctx, capture } = createContext();
		const refreshError = new Error(
			'OAuth credentials for provider "cline" are no longer valid. Re-run authentication for this provider.',
		);
		refreshError.name = "OAuthReauthRequiredError";
		resolveProviderApiKeyMock.mockRejectedValue(refreshError);
		getProviderSettingsMock.mockReturnValue(undefined);

		const result = await runClineAccountCommand(ctx);

		expect(isClineAccountNotAuthenticatedResult(result)).toBe(true);
		expect(executeClineAccountActionMock).not.toHaveBeenCalled();
		expect(capture).toHaveBeenCalledTimes(1);
		expect(capture).toHaveBeenCalledWith({
			event: "user.auth_refresh_soft_failure",
			properties: expect.objectContaining({
				provider: "cline",
				errorName: "OAuthReauthRequiredError",
				errorCode: "desktop_refresh_failed_no_fallback_token",
			}),
		});
	});
});
