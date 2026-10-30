import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ClineAccountService } from "../../account";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { FileSessionService } from "../../session/services/file-session-service";
import { NodeHubClient } from "../client";
import { createHubProviderAuthApi } from "../client/provider-auth";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubServerTransport } from "./hub-server-transport";
import { startHubWebSocketServer } from "./hub-websocket-server";

let root: string;
let transport: HubServerTransport;
let stopped = false;
const credentials = {
	access: "secret-access",
	refresh: "secret-refresh",
	expires: Date.now() + 3600_000,
	accountId: "account-1",
	email: "user@example.test",
};
const handler = getProviderAuthHandler("cline");
if (!handler) throw new Error("Cline auth handler is missing");
const send = (
	owner: string,
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown> = {},
) =>
	transport.handleCommand({ version: "v1", clientId: owner, command, payload });
const api = (owner = "owner") =>
	createHubProviderAuthApi({
		command: (command, payload) => send(owner, command, payload),
	});

beforeEach(async () => {
	stopped = false;
	root = await mkdtemp(join(tmpdir(), "hub-provider-auth-"));
	vi.stubEnv("CLINE_DATA_DIR", root);
	vi.stubEnv("CLINE_DIR", root);
	vi.stubEnv("CLINE_HOME_DIR", root);
	transport = new HubServerTransport({
		workspaceRoot: root,
		sessionHost: new LocalRuntimeHost({
			sessionService: new FileSessionService(join(root, "sessions")),
		}),
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
	});
});
afterEach(async () => {
	if (!stopped) await transport.stop();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("Hub-owned provider OAuth", () => {
	it("routes manual code requests to the initiating callback", async () => {
		vi.spyOn(handler, "login").mockImplementation(async ({ callbacks }) => {
			expect(await callbacks.onManualCodeInput?.()).toBe("manual-code");
			return credentials;
		});
		const onManualCodeInput = vi.fn(async () => "manual-code");
		const onPrompt = vi.fn(async () => "wrong");
		await api().login("cline", {
			onAuth: vi.fn(),
			onPrompt,
			onManualCodeInput,
		});
		expect(onManualCodeInput).toHaveBeenCalledOnce();
		expect(onPrompt).not.toHaveBeenCalled();
	});

	it("delivers browser/device interactions and persists tokens without returning them", async () => {
		vi.spyOn(handler, "login").mockImplementation(async ({ callbacks }) => {
			callbacks.onUserCode?.("CODE-123");
			callbacks.onAuth({ url: "https://example.test/sign-in" });
			return credentials;
		});
		const onAuth = vi.fn();
		const onUserCode = vi.fn();
		const result = await api().login("cline", {
			onAuth,
			onUserCode,
			onPrompt: async () => "",
		});
		expect(onAuth).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.test/sign-in" }),
		);
		expect(onUserCode).toHaveBeenCalledWith("CODE-123");
		expect(result).toEqual({
			provider: "cline",
			accountId: "account-1",
			email: "user@example.test",
		});
		expect(JSON.stringify(result)).not.toContain("secret-");
		expect(
			new ProviderSettingsManager().getProviderSettings("cline")?.auth
				?.accessToken,
		).toBe("workos:secret-access");
	});
	it("runs OAuth over the authenticated wire protocol without exposing stored tokens", async () => {
		const pending = deferred<typeof credentials>();
		vi.spyOn(handler, "login").mockImplementation(async ({ callbacks }) => {
			callbacks.onAuth({ url: "https://example.test/login" });
			return pending.promise;
		});
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: createInMemoryHubOwnerContext("oauth-wire"),
			sessionHost: new LocalRuntimeHost({
				sessionService: new FileSessionService(join(root, "wire-sessions")),
			}),
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			eventLog: false,
			runQueue: false,
			sessionSearchOptions: { dbPath: ":memory:" },
		});
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "oauth-test",
			clientId: "oauth-owner",
		});
		try {
			await client.connect();
			const onAuth = vi.fn();
			const login = createHubProviderAuthApi(client).login("cline", {
				onAuth,
				onPrompt: async () => "",
			});
			await vi.waitFor(() => expect(onAuth).toHaveBeenCalled());
			const attacker = new WebSocket(server.url, {
				origin: "http://localhost:3125",
			});
			try {
				await new Promise<void>((resolve, reject) => {
					attacker.once("open", resolve);
					attacker.once("error", reject);
				});
				const reply = new Promise<HubReplyEnvelope>((resolve) => {
					attacker.once("message", (data) =>
						resolve(JSON.parse(String(data)).envelope),
					);
				});
				attacker.send(
					JSON.stringify({
						kind: "command",
						envelope: {
							version: "v1",
							requestId: "spoof-unregister",
							clientId: "oauth-owner",
							command: "client.unregister",
						},
					}),
				);
				expect(await reply).toMatchObject({
					ok: false,
					error: { code: "client_not_registered" },
				});
			} finally {
				attacker.close();
			}
			pending.resolve(credentials);
			const result = await login;
			expect(result).toMatchObject({
				provider: "cline",
				accountId: "account-1",
			});
			expect(onAuth).toHaveBeenCalled();
			expect(JSON.stringify(result)).not.toContain("secret-");
		} finally {
			await client.dispose();
			await server.close();
		}
	});

	it("round-trips manual prompts through the owning client", async () => {
		vi.spyOn(handler, "login").mockImplementation(async ({ callbacks }) => {
			expect(await callbacks.onPrompt({ message: "Enter code" })).toBe(
				"manual-code",
			);
			return credentials;
		});
		const onPrompt = vi.fn(async () => "manual-code");
		await api().login("cline", { onAuth: vi.fn(), onPrompt });
		expect(onPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Enter code" }),
		);
	});
	it("refuses another client's access to pending login state and cancellation", async () => {
		vi.spyOn(handler, "login").mockImplementation(
			async () => new Promise(() => {}),
		);
		await send("owner", "providers.oauth.start", {
			providerId: "cline",
			loginId: "private",
		});
		for (const command of [
			"providers.oauth.next",
			"providers.oauth.cancel",
		] as const) {
			await expect(
				send("other", command, { loginId: "private" }),
			).rejects.toThrow("does not belong");
		}
	});
	it("rejects unregistering a different connection's owner", async () => {
		const reply = await transport.handleCommand(
			{ version: "v1", command: "client.unregister", clientId: "victim" },
			{ clientId: "attacker", tokenAuthenticated: true },
		);
		expect(reply).toMatchObject({
			ok: false,
			error: { code: "client_authority_mismatch" },
		});
	});

	it("cancels on client abort and discards credentials from a late completion", async () => {
		const pending = deferred<typeof credentials>();
		let signal: AbortSignal | undefined;
		const login = vi
			.spyOn(handler, "login")
			.mockImplementation(async (input) => {
				signal = input.signal;
				return pending.promise;
			});
		const controller = new AbortController();
		const result = api().login(
			"cline",
			{ onAuth: vi.fn(), onPrompt: async () => "" },
			controller.signal,
		);
		const rejection = expect(result).rejects.toThrow();
		await vi.waitFor(() => expect(login).toHaveBeenCalled());
		controller.abort();
		await rejection;
		expect(signal?.aborted).toBe(true);
		pending.resolve(credentials);
		await Promise.resolve();
		expect(
			new ProviderSettingsManager().getProviderSettings("cline"),
		).toBeUndefined();
	});
	it("cancels a login when its Hub client unregisters", async () => {
		const pending = deferred<typeof credentials>();
		vi.spyOn(handler, "login").mockReturnValue(pending.promise);
		await send("owner", "providers.oauth.start", {
			providerId: "cline",
			loginId: "disconnect",
		});
		await send("owner", "client.unregister");
		pending.resolve(credentials);
		await vi.waitFor(async () =>
			expect(
				(await send("owner", "hub.status")).payload?.activeProviderMutations,
			).toBe(0),
		);
		expect(
			new ProviderSettingsManager().getProviderSettings("cline"),
		).toBeUndefined();
	});
	it("cancels sign-in before a provider credential write can be overwritten", async () => {
		const pending = deferred<typeof credentials>();
		vi.spyOn(handler, "login").mockReturnValue(pending.promise);
		await send("owner", "providers.oauth.start", {
			providerId: "cline",
			loginId: "sign-out",
		});
		await send("owner", "providers.settings.save", {
			providerId: "cline",
			apiKey: "replacement",
		});
		pending.resolve(credentials);
		await vi.waitFor(async () =>
			expect(
				(await send("owner", "hub.status")).payload?.activeProviderMutations,
			).toBe(0),
		);
		expect(
			new ProviderSettingsManager().getProviderSettings("cline")?.apiKey,
		).toBe("replacement");
	});
	it("supersedes Cline sign-in when Cline Pass starts against shared credentials", async () => {
		const pending = deferred<typeof credentials>();
		let signal: AbortSignal | undefined;
		vi.spyOn(handler, "login").mockImplementation(async (input) => {
			signal = input.signal;
			return pending.promise;
		});
		const passHandler = getProviderAuthHandler("cline-pass");
		if (!passHandler) throw new Error("Cline Pass handler is missing");
		vi.spyOn(passHandler, "login").mockResolvedValue(credentials);
		const first = api("first").login("cline", {
			onAuth: vi.fn(),
			onPrompt: async () => "",
		});
		const rejected = expect(first).rejects.toThrow();
		await vi.waitFor(() => expect(signal).toBeDefined());
		await api("second").login("cline-pass", {
			onAuth: vi.fn(),
			onPrompt: async () => "",
		});
		await rejected;
		expect(signal?.aborted).toBe(true);
		pending.resolve({ ...credentials, access: "late-access" });
		await Promise.resolve();
		expect(
			new ProviderSettingsManager().getProviderSettings("cline")?.auth
				?.accessToken,
		).toBe("workos:secret-access");
	});
	it("aborts active authorization on Hub shutdown and discards late credentials", async () => {
		const pending = deferred<typeof credentials>();
		let signal: AbortSignal | undefined;
		vi.spyOn(handler, "login").mockImplementation(async (input) => {
			signal = input.signal;
			return pending.promise;
		});
		await send("owner", "providers.oauth.start", {
			providerId: "cline",
			loginId: "shutdown",
		});
		await vi.waitFor(() => expect(signal).toBeDefined());
		await transport.stop();
		stopped = true;
		expect(signal?.aborted).toBe(true);
		pending.resolve(credentials);
		await Promise.resolve();
		expect(
			new ProviderSettingsManager().getProviderSettings("cline"),
		).toBeUndefined();
	});

	it("tracks login activity and rejects new logins during drain while allowing cancellation", async () => {
		vi.spyOn(handler, "login").mockImplementation(
			async () => new Promise(() => {}),
		);
		await send("owner", "providers.oauth.start", {
			providerId: "cline",
			loginId: "drain",
		});
		expect((await send("owner", "hub.status")).payload).toMatchObject({
			idle: false,
			activeProviderMutations: 1,
		});
		await send("owner", "hub.drain");
		expect(
			await send("owner", "providers.oauth.start", {
				providerId: "cline",
				loginId: "refused",
			}),
		).toMatchObject({ ok: false, error: { code: "hub_draining" } });
		expect(
			(await send("owner", "providers.oauth.cancel", { loginId: "drain" }))
				.payload,
		).toEqual({ cancelled: true });
	});
	it("requires token-authenticated authority for OAuth and account commands", async () => {
		for (const command of [
			"providers.oauth.start",
			"providers.account.action",
		] as const) {
			expect(
				await transport.handleCommand(
					{ version: "v1", clientId: "browser", command },
					{ clientId: "browser", tokenAuthenticated: false },
				),
			).toMatchObject({
				ok: false,
				error: { code: "authentication_required" },
			});
		}
	});
});

describe("Hub-owned account actions", () => {
	it("returns the shared signed-out result without an account request", async () => {
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue(null);
		const fetchMe = vi.spyOn(ClineAccountService.prototype, "fetchMe");
		expect(
			await api().account({ action: "clineAccount", operation: "fetchMe" }),
		).toEqual(CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT);
		expect(fetchMe).not.toHaveBeenCalled();
	});
	it("rejects revoked OAuth rather than sending the stale persisted token", async () => {
		new ProviderSettingsManager().saveProviderSettings({
			provider: "cline",
			apiKey: "stale",
		});
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockRejectedValue(new OAuthReauthRequiredError("cline"));
		const fetchMe = vi.spyOn(ClineAccountService.prototype, "fetchMe");
		expect(
			await api().account({ action: "clineAccount", operation: "fetchMe" }),
		).toEqual(CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT);
		expect(fetchMe).not.toHaveBeenCalled();
	});
	it("keeps account identity persistence in the Hub", async () => {
		const manager = new ProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "cline",
			auth: { accountId: "account-1", accessToken: "token" },
		});
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue({
			apiKey: "workos:token",
			refreshed: false,
		});
		const user = {
			id: "account-1",
			email: "user@example.test",
			displayName: "User",
			photoUrl: "",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
			organizations: [
				{
					active: true,
					memberId: "member-1",
					name: "Team",
					organizationId: "org-1",
					roles: [],
				},
			],
		};
		vi.spyOn(ClineAccountService.prototype, "fetchMe").mockResolvedValue(user);
		expect(
			await api().account({ action: "clineAccount", operation: "fetchMe" }),
		).toEqual(user);
		expect(manager.getProviderSettings("cline")?.auth).toMatchObject({
			organizationId: "org-1",
			memberId: "member-1",
		});
	});
	it("uses persisted credentials after a transient refresh failure", async () => {
		new ProviderSettingsManager().saveProviderSettings({
			provider: "cline",
			apiKey: "persisted",
		});
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockRejectedValue(new Error("Temporary refresh failure"));
		const balance = { balance: 5, userId: "account-1" };
		const fetchBalance = vi
			.spyOn(ClineAccountService.prototype, "fetchBalance")
			.mockResolvedValue(balance);
		expect(
			await api().account({
				action: "clineAccount",
				operation: "fetchBalance",
				userId: "account-1",
			}),
		).toEqual(balance);
		expect(fetchBalance).toHaveBeenCalledWith("account-1");
	});
	it("does not return a stale account response after sign-out", async () => {
		const manager = new ProviderSettingsManager();
		manager.saveProviderSettings({ provider: "cline", apiKey: "original" });
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue({ apiKey: "original", refreshed: false });
		const gate = deferred<{ balance: number; userId: string }>();
		const fetchBalance = vi
			.spyOn(ClineAccountService.prototype, "fetchBalance")
			.mockReturnValue(gate.promise);
		const result = api().account({
			action: "clineAccount",
			operation: "fetchBalance",
			userId: "account-1",
		});
		const rejection = expect(result).rejects.toThrow("account changed");
		await vi.waitFor(() => expect(fetchBalance).toHaveBeenCalled());
		await send("owner", "providers.settings.save", {
			providerId: "cline",
			enabled: false,
		});
		gate.resolve({ balance: 5, userId: "account-1" });
		await rejection;
	});

	it("validates operation arguments before resolving credentials or calling the API", async () => {
		const tokens = vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		);
		await expect(
			send("owner", "providers.account.action", {
				action: "clineAccount",
				operation: "switchAccount",
				arbitrary: true,
			}),
		).rejects.toThrow();
		expect(tokens).not.toHaveBeenCalled();
	});
});
