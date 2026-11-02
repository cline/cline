import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cancelProviderOAuthLogin,
	cancelProviderOAuthLoginsForOwner,
	runProviderOAuthLogin,
} from "./oauth-login";
import type { SidecarContext } from "./types";

const login = vi.hoisted(() => vi.fn());
vi.mock("@cline/core", () => ({ createHubProviderAuthApi: () => ({ login }) }));
vi.mock("./context", () => ({
	ensureSharedHubClient: vi.fn().mockResolvedValue({}),
}));
afterEach(() => login.mockReset());
const ctx = {} as SidecarContext;

describe("Desktop OAuth interaction adapter", () => {
	it("forwards browser/device-code interactions and returns Hub completion metadata", async () => {
		const open = vi.fn();
		const onUserCode = vi.fn();
		login.mockImplementation(async (_provider, callbacks) => {
			callbacks.onAuth({ url: "https://example.test/sign-in" });
			callbacks.onUserCode("ABC");
			return { provider: "cline", accountId: "account-1" };
		});
		expect(
			await runProviderOAuthLogin(ctx, "cline", open, {
				owner: {},
				onUserCode,
			}),
		).toEqual({ provider: "cline", accountId: "account-1" });
		expect(open).toHaveBeenCalledWith("https://example.test/sign-in");
		expect(onUserCode).toHaveBeenCalledWith("ABC");
	});
	it("aborts only the initiating webview's login on disconnect", async () => {
		let signal: AbortSignal | undefined;
		login.mockImplementation(async (_provider, _callbacks, abort) => {
			signal = abort;
			return new Promise((_, reject) =>
				abort.addEventListener("abort", () => reject(abort.reason)),
			);
		});
		const owner = {};
		const pending = runProviderOAuthLogin(ctx, "cline", vi.fn(), { owner });
		const rejection = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(login).toHaveBeenCalled());
		expect(cancelProviderOAuthLogin("cline", {})).toBe(false);
		expect(cancelProviderOAuthLoginsForOwner({})).toBe(0);
		expect(cancelProviderOAuthLoginsForOwner(owner)).toBe(1);
		await rejection;
		expect(signal?.aborted).toBe(true);
	});
});
