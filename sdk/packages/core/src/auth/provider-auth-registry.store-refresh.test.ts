import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import { withSettingsRefreshLock } from "../services/storage/settings-file-lock";
import { refreshProviderOAuthCredentialsFromStore } from "./provider-auth-registry";

const ORIGINAL_FETCH = globalThis.fetch;
const API_BASE = "https://auth.example.com";

function tokenResponse(generation: number): Response {
	return new Response(
		JSON.stringify({
			success: true,
			data: {
				accessToken: `access-${generation}`,
				refreshToken: `refresh-${generation}`,
				tokenType: "Bearer",
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
				userInfo: {
					subject: "sub-1",
					email: "user@example.com",
					name: "User",
					clineUserId: "acct-1",
					accounts: [],
				},
			},
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

function invalidGrantResponse(): Response {
	return new Response(
		JSON.stringify({
			error: "invalid_grant",
			error_description: "refresh token already used",
		}),
		{ status: 400, headers: { "Content-Type": "application/json" } },
	);
}

describe("refreshProviderOAuthCredentialsFromStore", () => {
	let dir: string;
	let manager: ProviderSettingsManager;
	let capture: ReturnType<typeof vi.fn>;
	let telemetry: never;

	const seed = (refreshToken: string, options?: { expiresAt?: number }) => {
		manager.saveProviderSettings(
			{
				provider: "cline",
				baseUrl: API_BASE,
				auth: {
					accessToken: "workos:access-old",
					refreshToken,
					accountId: "acct-1",
					expiresAt: options?.expiresAt ?? Date.now() - 1_000,
				},
			},
			{ tokenSource: "oauth", setLastUsed: false },
		);
	};

	const capturedEvents = () =>
		capture.mock.calls.map((c) => (c[0] as { event: string }).event);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "store-refresh-test-"));
		manager = new ProviderSettingsManager({
			filePath: join(dir, "providers.json"),
		});
		// lastUsedProvider baseline that refreshes must not disturb
		manager.saveProviderSettings(
			{ provider: "openrouter", apiKey: "or-key" },
			{ setLastUsed: true },
		);
		capture = vi.fn();
		telemetry = { capture } as never;
	});

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
		rmSync(dir, { recursive: true, force: true });
	});

	it("refreshes, persists, and leaves lastUsedProvider untouched", async () => {
		seed("refresh-old");
		globalThis.fetch = vi.fn(async () =>
			tokenResponse(1),
		) as unknown as typeof fetch;

		const outcome = await refreshProviderOAuthCredentialsFromStore({
			manager,
			providerId: "cline",
			telemetry,
		});

		expect(outcome.status).toBe("ok");
		if (outcome.status !== "ok") return;
		expect(outcome.refreshed).toBe(true);
		expect(outcome.credentials.refresh).toBe("refresh-1");

		const onDisk = JSON.parse(readFileSync(manager.getFilePath(), "utf8"));
		expect(onDisk.providers.cline.settings.auth.refreshToken).toBe("refresh-1");
		expect(onDisk.providers.cline.settings.auth.accessToken).toBe(
			"workos:access-1",
		);
		expect(onDisk.lastUsedProvider).toBe("openrouter");
		expect(capturedEvents()).not.toContain("user.auth_logged_out");
	});

	it("adopts credentials rotated on disk when the refresh comes back invalid_grant", async () => {
		seed("refresh-old");
		const fetchMock = vi.fn(
			async (_url: unknown, init?: { body?: unknown }) => {
				const body = JSON.parse(String(init?.body ?? "{}")) as {
					refreshToken?: string;
				};
				if (body.refreshToken === "refresh-old") {
					// Simulate a non-cooperating process (legacy extension) that already
					// rotated: our token is consumed, but the fresh one is on disk.
					seed("refresh-rotated");
					return invalidGrantResponse();
				}
				expect(body.refreshToken).toBe("refresh-rotated");
				return tokenResponse(2);
			},
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const outcome = await refreshProviderOAuthCredentialsFromStore({
			manager,
			providerId: "cline",
			forceRefresh: true,
			telemetry,
		});

		expect(outcome.status).toBe("ok");
		if (outcome.status !== "ok") return;
		expect(outcome.credentials.refresh).toBe("refresh-2");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(capturedEvents()).toContain("user.auth_refresh_recovered");
		expect(capturedEvents()).not.toContain("user.auth_logged_out");
	});

	it("skips its own rotation when another process rotated while it waited for the lock", async () => {
		seed("refresh-old");
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		// Queue ahead of the helper on the same lock: by the time the helper's
		// body runs, disk holds freshly-rotated, unexpired credentials.
		const winner = withSettingsRefreshLock(manager.getFilePath(), async () => {
			seed("refresh-rotated", { expiresAt: Date.now() + 3_600_000 });
		});
		const outcomePromise = refreshProviderOAuthCredentialsFromStore({
			manager,
			providerId: "cline",
			forceRefresh: true,
			telemetry,
		});
		await winner;
		const outcome = await outcomePromise;

		expect(outcome.status).toBe("ok");
		if (outcome.status !== "ok") return;
		expect(outcome.credentials.refresh).toBe("refresh-rotated");
		expect(outcome.refreshed).toBe(false);
		// The winner's tokens were still valid — no network call at all.
		expect(fetchMock).not.toHaveBeenCalled();
		expect(capturedEvents()).toContain("user.auth_refresh_recovered");
		expect(capturedEvents()).not.toContain("user.auth_logged_out");
	});

	it("returns reauth_required with one logged-out event when the on-disk token is truly rejected", async () => {
		seed("refresh-old");
		globalThis.fetch = vi.fn(async () =>
			invalidGrantResponse(),
		) as unknown as typeof fetch;

		const outcome = await refreshProviderOAuthCredentialsFromStore({
			manager,
			providerId: "cline",
			forceRefresh: true,
			telemetry,
		});

		expect(outcome.status).toBe("reauth_required");
		expect(
			capturedEvents().filter((e) => e === "user.auth_logged_out"),
		).toHaveLength(1);
		// Credentials stay on disk — clients decide what to do with reauth_required.
		const onDisk = JSON.parse(readFileSync(manager.getFilePath(), "utf8"));
		expect(onDisk.providers.cline.settings.auth.refreshToken).toBe(
			"refresh-old",
		);
	});

	it("throws on transient failure and leaves the store byte-identical", async () => {
		seed("refresh-old");
		const before = readFileSync(manager.getFilePath(), "utf8");
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ error: "server_error", message: "boom" }),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					},
				),
		) as unknown as typeof fetch;

		await expect(
			refreshProviderOAuthCredentialsFromStore({
				manager,
				providerId: "cline",
				forceRefresh: true,
				telemetry,
			}),
		).rejects.toThrow("Token refresh failed: 500");

		expect(readFileSync(manager.getFilePath(), "utf8")).toBe(before);
		expect(capturedEvents()).not.toContain("user.auth_logged_out");
	});

	it("returns no_credentials when another process logged out while it waited", async () => {
		seed("refresh-old");
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const winner = withSettingsRefreshLock(manager.getFilePath(), async () => {
			const existing = manager.getProviderSettings("cline");
			manager.saveProviderSettings(
				{ ...existing, provider: "cline", auth: undefined },
				{ tokenSource: "manual" },
			);
		});
		const outcomePromise = refreshProviderOAuthCredentialsFromStore({
			manager,
			providerId: "cline",
			forceRefresh: true,
			telemetry,
		});
		await winner;
		const outcome = await outcomePromise;

		expect(outcome.status).toBe("no_credentials");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
