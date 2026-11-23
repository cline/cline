import { describe, expect, it, vi } from "vitest";
import {
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
	resolveUrl,
} from "./utils";

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

	it("parses auth input from relative callback paths with query strings", () => {
		expect(
			parseAuthorizationInput("/callback?code=abc&state=xyz&provider=google", {
				includeProvider: true,
			}),
		).toEqual({
			code: "abc",
			state: "xyz",
			provider: "google",
		});
		expect(parseAuthorizationInput("/callback?state=xyz&code=abc")).toEqual({
			code: "abc",
			state: "xyz",
			provider: undefined,
		});
	});

	it("parses auth input from absolute and relative URLs with fragment parameters", () => {
		expect(
			parseAuthorizationInput(
				"http://localhost:8080/callback#code=abc&state=xyz",
			),
		).toEqual({
			code: "abc",
			state: "xyz",
			provider: undefined,
		});
		expect(
			parseAuthorizationInput(
				"http://localhost:8080/callback#code=abc&state=xyz&provider=google",
				{
					allowHashCodeState: true,
					includeProvider: true,
				},
			),
		).toEqual({
			code: "abc",
			state: "xyz",
			provider: "google",
		});
		expect(parseAuthorizationInput("/callback#code=abc&state=xyz")).toEqual({
			code: "abc",
			state: "xyz",
			provider: undefined,
		});
	});

	it("returns undefined code for bare paths and error redirects", () => {
		expect(parseAuthorizationInput("/callback")).toEqual({
			code: undefined,
			state: undefined,
			provider: undefined,
		});
		expect(parseAuthorizationInput("/callback?error=access_denied")).toEqual({
			code: undefined,
			state: undefined,
			provider: undefined,
		});
		expect(
			parseAuthorizationInput(
				"http://localhost:8080/callback?error=access_denied",
			),
		).toEqual({
			code: undefined,
			state: undefined,
			provider: undefined,
		});
		expect(
			parseAuthorizationInput(
				"http://localhost:8080/callback#error=access_denied",
			),
		).toEqual({
			code: undefined,
			state: undefined,
			provider: undefined,
		});
	});

	it("falls back to raw authorization codes", () => {
		expect(parseAuthorizationInput("raw-auth-code")).toEqual({
			code: "raw-auth-code",
		});
		expect(parseAuthorizationInput("4/0AfJohXn==")).toEqual({
			code: "4/0AfJohXn==",
		});
	});

	it("builds resolved URLs from base + path", () => {
		expect(resolveUrl("https://example.com/", "/token")).toBe(
			"https://example.com/token",
		);
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
