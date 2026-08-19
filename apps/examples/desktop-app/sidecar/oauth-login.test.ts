import type { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	cancelProviderOAuthLogin,
	cancelProviderOAuthLoginsForOwner,
	OAuthLoginCancelledError,
	runCancellableProviderOAuthLogin,
} from "./oauth-login";

type Credentials = { accessToken: string };

function makeManager(): ProviderSettingsManager {
	return {
		getProviderSettings: () => undefined,
	} as unknown as ProviderSettingsManager;
}

function makeDependencies(overrides: {
	login: () => Promise<Credentials>;
	save?: ReturnType<typeof vi.fn>;
}) {
	const save =
		overrides.save ??
		vi.fn(() => ({
			provider: "cline",
			auth: { accessToken: "saved-token" },
		}));
	return {
		dependencies: {
			login: overrides.login as never,
			save: save as never,
			markEnabled: vi.fn() as never,
		},
		save,
	};
}

describe("runCancellableProviderOAuthLogin", () => {
	it("saves credentials and returns the access token on success", async () => {
		const { dependencies, save } = makeDependencies({
			login: async () => ({ accessToken: "fresh-token" }),
		});

		const result = await runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{},
			dependencies,
		);

		expect(save).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ provider: "cline", accessToken: "saved-token" });
	});

	it("rejects promptly on cancel and never persists a late completion", async () => {
		let resolveLogin: (credentials: Credentials) => void = () => undefined;
		const { dependencies, save } = makeDependencies({
			login: () =>
				new Promise<Credentials>((resolve) => {
					resolveLogin = resolve;
				}),
		});

		const pending = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{},
			dependencies,
		);
		// Cancellation must reject the pending login right away, without
		// waiting for the browser round-trip to finish.
		expect(cancelProviderOAuthLogin("cline")).toBe(true);
		await expect(pending).rejects.toBeInstanceOf(OAuthLoginCancelledError);

		// The user completes the abandoned browser flow afterwards: the
		// credentials must be discarded, not saved.
		resolveLogin({ accessToken: "late-token" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(save).not.toHaveBeenCalled();
	});

	it("reports when there is no pending login to cancel", () => {
		expect(cancelProviderOAuthLogin("cline")).toBe(false);
	});

	it("cancels a dangling attempt when a new login starts for the provider", async () => {
		let resolveFirstLogin: (credentials: Credentials) => void = () => undefined;
		const firstSave = vi.fn(() => ({
			provider: "cline",
			auth: { accessToken: "first-token" },
		}));
		const first = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{},
			makeDependencies({
				login: () =>
					new Promise<Credentials>((resolve) => {
						resolveFirstLogin = resolve;
					}),
				save: firstSave,
			}).dependencies,
		);

		const { dependencies: secondDependencies, save: secondSave } =
			makeDependencies({
				login: async () => ({ accessToken: "second-token" }),
			});
		const second = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{},
			secondDependencies,
		);

		await expect(first).rejects.toBeInstanceOf(OAuthLoginCancelledError);
		await expect(second).resolves.toEqual({
			provider: "cline",
			accessToken: "saved-token",
		});

		// The first attempt's late completion is discarded.
		resolveFirstLogin({ accessToken: "first-token" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(firstSave).not.toHaveBeenCalled();
		expect(secondSave).toHaveBeenCalledTimes(1);
	});

	it("cancels pending logins when their transport connection closes", async () => {
		let resolveLogin: (credentials: Credentials) => void = () => undefined;
		const { dependencies, save } = makeDependencies({
			login: () =>
				new Promise<Credentials>((resolve) => {
					resolveLogin = resolve;
				}),
		});
		const connection = {};

		const pending = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{ owner: connection },
			dependencies,
		);

		// A different connection closing must not cancel this login.
		expect(cancelProviderOAuthLoginsForOwner({})).toBe(0);

		// The initiating connection closing cancels it, so a lost cancel
		// command (transport drop, webview reload) cannot leave an abandoned
		// flow that persists credentials later.
		expect(cancelProviderOAuthLoginsForOwner(connection)).toBe(1);
		await expect(pending).rejects.toBeInstanceOf(OAuthLoginCancelledError);

		resolveLogin({ accessToken: "late-token" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(save).not.toHaveBeenCalled();
	});
});
