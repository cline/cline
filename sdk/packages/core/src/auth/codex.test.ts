import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getValidOpenAICodexCredentials,
	loginOpenAICodex,
	OPENAI_CODEX_OAUTH_CONFIG,
	refreshOpenAICodexToken,
} from "./codex";
import type { OAuthCredentials } from "./types";

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

function createCredentials(
	overrides: Partial<OAuthCredentials> = {},
): OAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "acct-old",
		email: "old@example.com",
		metadata: { provider: "openai-codex" },
		...overrides,
	};
}

describe("auth/codex token lifecycle", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns current credentials when not expired", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const current = createCredentials({ expires: 400_000 });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await getValidOpenAICodexCredentials(current);
		expect(result).toBe(current);
		expect(fetchMock).not.toHaveBeenCalled();
		nowSpy.mockRestore();
	});

	it("refreshes expired credentials and preserves provider metadata", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const idToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-new" },
			email: "new@example.com",
		});
		const accessToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-new" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							access_token: accessToken,
							refresh_token: "refresh-new",
							expires_in: 3600,
							email: "new@example.com",
							id_token: idToken,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		const current = createCredentials({ expires: 110_000 });
		const result = await getValidOpenAICodexCredentials(current);
		expect(result).toMatchObject({
			access: accessToken,
			refresh: "refresh-new",
			accountId: "acct-new",
			email: "new@example.com",
			metadata: { provider: "openai-codex" },
		});
		nowSpy.mockRestore();
	});

	it("returns null on invalid_grant refresh errors", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "invalid_grant",
							error_description: "token revoked",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);

		const result = await getValidOpenAICodexCredentials(
			createCredentials({ expires: 120_000 }),
		);
		expect(result).toBeNull();
		nowSpy.mockRestore();
	});

	it("keeps current credentials on non-invalid transient refresh failures when still valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "try again",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);

		const capture = vi.fn();
		const current = createCredentials({ expires: 150_000 });
		const result = await getValidOpenAICodexCredentials(current, {
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
			telemetry: { capture } as never,
		});
		expect(result).toBe(current);
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					provider: "openai-codex",
					status: 500,
					tokenExpired: false,
				}),
			}),
		);
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_logged_out" }),
		);
		nowSpy.mockRestore();
	});

	it("refreshOpenAICodexToken throws when response is structurally invalid", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ access_token: "only-access" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);

		await expect(refreshOpenAICodexToken("refresh")).rejects.toThrow(
			"Failed to refresh OpenAI Codex token",
		);
	});

	it("throws on transient refresh error when the token is already expired", async () => {
		// A server error landing after expiry is NOT an invalid grant; returning
		// null here is what turned an outage blip into a forced
		// "requires re-authentication" stop.
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "temporary issue",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		const capture = vi.fn();
		await expect(
			getValidOpenAICodexCredentials(createCredentials({ expires: 90_000 }), {
				telemetry: { capture } as never,
			}),
		).rejects.toThrow("Token refresh failed: 500");
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					provider: "openai-codex",
					status: 500,
					tokenExpired: true,
				}),
			}),
		);
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_logged_out" }),
		);
		nowSpy.mockRestore();
	});

	it("throws on a network-level refresh failure when the token is already expired", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);

		const capture = vi.fn();
		await expect(
			getValidOpenAICodexCredentials(createCredentials({ expires: 90_000 }), {
				telemetry: { capture } as never,
			}),
		).rejects.toThrow("Failed to refresh OpenAI Codex token");
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					provider: "openai-codex",
					tokenExpired: true,
				}),
			}),
		);
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_logged_out" }),
		);
		nowSpy.mockRestore();
	});
});

// Codex OAuth uses the fixed registered redirect port (1455). These tests
// occupy that real port, so they are skipped in sandboxes where binding it is
// not possible.
const canBindCodexPort = await (async () => {
	try {
		const srv = net.createServer();
		await new Promise<void>((resolve, reject) => {
			srv.once("error", reject);
			srv.listen(OPENAI_CODEX_OAUTH_CONFIG.callbackPort, "localhost", () =>
				resolve(),
			);
		});
		await new Promise<void>((resolve) => {
			srv.close(() => resolve());
		});
		return true;
	} catch {
		return false;
	}
})();
const codexPortIt = canBindCodexPort ? it : it.skip;

async function occupyCodexPort(): Promise<net.Server> {
	const blocker = net.createServer();
	await new Promise<void>((resolve, reject) => {
		blocker.once("error", reject);
		blocker.listen(OPENAI_CODEX_OAUTH_CONFIG.callbackPort, "localhost", () =>
			resolve(),
		);
	});
	return blocker;
}

describe("auth/codex loginOpenAICodex — callback port unavailable", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	codexPortIt(
		"fails fast before opening the browser when the port is occupied and no manual fallback exists",
		async () => {
			const blocker = await occupyCodexPort();
			try {
				const onAuth = vi.fn();
				await expect(
					loginOpenAICodex({ onAuth, onPrompt: async () => "" }),
				).rejects.toThrow(/already in use/);
				expect(onAuth).not.toHaveBeenCalled();
			} finally {
				await new Promise<void>((resolve) => {
					blocker.close(() => resolve());
				});
			}
		},
	);

	codexPortIt(
		"continues via manual code entry when the port is occupied but a manual fallback exists",
		async () => {
			const accessToken = createJwt({
				"https://api.openai.com/auth": { chatgpt_account_id: "acct-manual" },
			});
			vi.stubGlobal(
				"fetch",
				vi.fn(
					async () =>
						new Response(
							JSON.stringify({
								access_token: accessToken,
								refresh_token: "refresh-manual",
								expires_in: 3600,
								email: "manual@example.com",
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } },
						),
				),
			);

			const blocker = await occupyCodexPort();
			try {
				const onAuth = vi.fn();
				const credentials = await loginOpenAICodex({
					onAuth,
					onPrompt: async () => "",
					onManualCodeInput: async () => "manual-auth-code",
				});
				expect(onAuth).toHaveBeenCalledOnce();
				expect(credentials).toMatchObject({
					access: accessToken,
					refresh: "refresh-manual",
					accountId: "acct-manual",
				});
			} finally {
				await new Promise<void>((resolve) => {
					blocker.close(() => resolve());
				});
			}
		},
	);
});
