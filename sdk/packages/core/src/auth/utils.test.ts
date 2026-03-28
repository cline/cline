import { describe, expect, it, vi } from "vitest";
import {
	decodeJwtPayload,
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
	resolveUrl,
} from "./utils";

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

describe("auth/utils", () => {
	it("parses auth input from full URL with provider", () => {
		const parsed = parseAuthorizationInput(
			"http://localhost/callback?code=test-code&state=s1&provider=google",
			{
				includeProvider: true,
			},
		);
		expect(parsed).toEqual({
			code: "test-code",
			state: "s1",
			provider: "google",
		});
	});

	it("parses auth input from hash format when enabled", () => {
		const parsed = parseAuthorizationInput("abc123#state1", {
			allowHashCodeState: true,
		});
		expect(parsed).toEqual({ code: "abc123", state: "state1" });
	});

	it("builds resolved URLs from base + path", () => {
		expect(resolveUrl("https://example.com/", "/token")).toBe(
			"https://example.com/token",
		);
	});

	it("decodes JWT payload", () => {
		const token = createJwt({ sub: "account-1", exp: 123 });
		expect(decodeJwtPayload(token)).toMatchObject({
			sub: "account-1",
			exp: 123,
		});
		expect(decodeJwtPayload("invalid")).toBeNull();
	});

	it("parses OAuth error payloads from string and object forms", () => {
		expect(
			parseOAuthError(
				JSON.stringify({
					error: "invalid_grant",
					error_description: "expired",
				}),
			),
		).toEqual({
			code: "invalid_grant",
			message: "expired",
		});
		expect(
			parseOAuthError(
				JSON.stringify({ error: { type: "unauthorized", message: "denied" } }),
			),
		).toEqual({
			code: "unauthorized",
			message: "denied",
		});
	});

	it("resolves code from callback result", async () => {
		const result = await resolveAuthorizationCodeInput({
			waitForCallback: async () => ({
				url: new URL("http://localhost"),
				code: "from-callback",
				state: "s1",
			}),
			cancelWait: () => {},
		});
		expect(result).toEqual({
			code: "from-callback",
			state: "s1",
			provider: undefined,
			error: undefined,
		});
	});

	it("resolves code from manual input when callback does not provide one", async () => {
		const cancelWait = vi.fn();
		const result = await resolveAuthorizationCodeInput({
			waitForCallback: async () => null,
			cancelWait,
			onManualCodeInput: async () => "code=manual&state=manual-state",
		});
		expect(cancelWait).toHaveBeenCalled();
		expect(result).toEqual({
			code: "manual",
			state: "manual-state",
			provider: undefined,
		});
	});

	it("throws when manual input rejects", async () => {
		await expect(
			resolveAuthorizationCodeInput({
				waitForCallback: async () => null,
				cancelWait: () => {},
				onManualCodeInput: async () => {
					throw new Error("cancelled");
				},
			}),
		).rejects.toThrow("cancelled");
	});

	it("checks token expiry with configurable buffer", () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
		expect(isCredentialLikelyExpired({ expires: 1_500 }, 600)).toBe(true);
		expect(isCredentialLikelyExpired({ expires: 3_000 }, 600)).toBe(false);
		nowSpy.mockRestore();
	});
});
