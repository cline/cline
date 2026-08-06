import type { OAuthPrompt, ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	cancelProviderOAuthLogin,
	cancelProviderOAuthLoginsForOwner,
	OAuthLoginCancelledError,
	respondOAuthPrompt,
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

	it("forwards output lines and manual prompts over the broadcast channel", async () => {
		const broadcast = vi.fn();
		type LoginOverrides = {
			onOutput?: (message: string) => void;
			onPrompt?: (prompt: OAuthPrompt) => Promise<string>;
		};
		const { dependencies, save } = makeDependencies({
			login: (async (
				_providerId: string,
				_existing: unknown,
				_openUrl: unknown,
				_telemetry: unknown,
				overrides?: LoginOverrides,
			) => {
				overrides?.onOutput?.("Enter this code in your browser: ABCD-1234");
				const code = await overrides?.onPrompt?.({
					message: "Paste the authorization code:",
				});
				expect(code).toBe("pasted-code");
				return { accessToken: "fresh-token" };
			}) as never as () => Promise<Credentials>,
		});

		const pending = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{ broadcast },
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Progress lines (device-auth user codes) must reach the UI.
		expect(broadcast).toHaveBeenCalledWith("oauth_login_output", {
			provider: "cline",
			message: "Enter this code in your browser: ABCD-1234",
		});

		// The manual prompt round-trips: the UI answers by prompt id.
		const promptCall = broadcast.mock.calls.find(
			([name]) => name === "oauth_prompt_requested",
		);
		expect(promptCall).toBeDefined();
		const promptPayload = promptCall?.[1] as {
			promptId: string;
			provider: string;
			message: string;
		};
		expect(promptPayload.provider).toBe("cline");
		expect(promptPayload.message).toBe("Paste the authorization code:");
		expect(respondOAuthPrompt(promptPayload.promptId, "pasted-code")).toBe(
			true,
		);

		await expect(pending).resolves.toEqual({
			provider: "cline",
			accessToken: "saved-token",
		});
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("reports when there is no pending prompt to answer", () => {
		expect(respondOAuthPrompt("missing-prompt", "value")).toBe(false);
	});

	it("closes an open manual prompt when the login is cancelled", async () => {
		const broadcast = vi.fn();
		type LoginOverrides = {
			onPrompt?: (prompt: OAuthPrompt) => Promise<string>;
		};
		let promptAnswer: Promise<string> | undefined;
		const { dependencies, save } = makeDependencies({
			login: ((
				_providerId: string,
				_existing: unknown,
				_openUrl: unknown,
				_telemetry: unknown,
				overrides?: LoginOverrides,
			) => {
				promptAnswer = overrides?.onPrompt?.({
					message: "Paste the authorization code:",
				});
				// Never resolves: the login hangs on the prompt.
				return new Promise<Credentials>(() => undefined);
			}) as never as () => Promise<Credentials>,
		});

		const pending = runCancellableProviderOAuthLogin(
			makeManager(),
			"cline",
			() => undefined,
			{ broadcast },
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const promptPayload = broadcast.mock.calls.find(
			([name]) => name === "oauth_prompt_requested",
		)?.[1] as { promptId: string };

		expect(cancelProviderOAuthLogin("cline")).toBe(true);
		await expect(pending).rejects.toBeInstanceOf(OAuthLoginCancelledError);

		// The UI is told to close the prompt, and the dangling prompt promise
		// settles so it cannot leak.
		expect(broadcast).toHaveBeenCalledWith(
			"oauth_prompt_cancelled",
			expect.objectContaining({ promptId: promptPayload.promptId }),
		);
		await expect(promptAnswer).resolves.toBe("");
		// A late answer for the closed prompt is rejected.
		expect(respondOAuthPrompt(promptPayload.promptId, "late")).toBe(false);
		expect(save).not.toHaveBeenCalled();
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
