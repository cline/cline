import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getValidOpenAICodexCredentials,
	normalizeOpenAICodexCredentials,
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

		const current = createCredentials({ expires: 150_000 });
		const result = await getValidOpenAICodexCredentials(current, {
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
		});
		expect(result).toBe(current);
		nowSpy.mockRestore();
	});

	it("normalizes credentials by deriving accountId from access token", () => {
		const accessToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-derived" },
		});
		const normalized = normalizeOpenAICodexCredentials({
			access: accessToken,
			refresh: "refresh",
			expires: 1,
		});
		expect(normalized.accountId).toBe("acct-derived");
		expect(normalized.metadata).toMatchObject({ provider: "openai-codex" });
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
});
