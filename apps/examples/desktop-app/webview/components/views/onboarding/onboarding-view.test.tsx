// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProvider } from "@/contexts/account-context";
import {
	MODEL_SELECTION_STORAGE_KEY,
	parseModelSelectionStorage,
} from "@/lib/model-selection";
import type { Provider } from "@/lib/provider-schema";
import { OnboardingView, sortProvidersForApiKeySetup } from "./onboarding-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl: vi.fn(),
}));

function makeProvider(overrides: Partial<Provider> = {}): Provider {
	return {
		id: "anthropic",
		name: "Anthropic",
		models: 4,
		color: "#000",
		letter: "A",
		enabled: false,
		...overrides,
	};
}

describe("sortProvidersForApiKeySetup", () => {
	it("drops OAuth-managed providers and ranks popular ones first", () => {
		const sorted = sortProvidersForApiKeySetup([
			makeProvider({ id: "zai", name: "Z AI" }),
			makeProvider({ id: "cline", name: "Cline" }),
			makeProvider({ id: "openai-codex", name: "ChatGPT" }),
			makeProvider({ id: "openrouter", name: "OpenRouter" }),
			makeProvider({ id: "anthropic", name: "Anthropic" }),
			makeProvider({ id: "baseten", name: "Baseten" }),
		]);
		expect(sorted.map((provider) => provider.id)).toEqual([
			"anthropic",
			"openrouter",
			"baseten",
			"zai",
		]);
	});

	it("drops providers the API-key form cannot fully configure", () => {
		const apiKeyField = {
			path: "apiKey",
			label: "API Key",
			type: "password" as const,
		};
		const sorted = sortProvidersForApiKeySetup([
			makeProvider({
				id: "vertex",
				name: "Google Vertex AI",
				configFields: [
					{ path: "gcp.projectId", label: "Project", type: "text" },
					apiKeyField,
				],
			}),
			makeProvider({
				id: "bedrock",
				name: "AWS Bedrock",
				configFields: [
					{ path: "aws.region", label: "Region", type: "text" },
					apiKeyField,
				],
			}),
			makeProvider({
				id: "claude-code",
				name: "Claude Code",
				configFields: [],
			}),
			makeProvider({
				id: "ollama",
				name: "Ollama",
				configFields: [
					apiKeyField,
					{ path: "baseUrl", label: "Base URL", type: "url" },
				],
			}),
			makeProvider({ id: "anthropic", name: "Anthropic" }),
		]);
		expect(sorted.map((provider) => provider.id)).toEqual([
			"anthropic",
			"ollama",
		]);
	});
});

describe("OnboardingView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		window.localStorage.clear();
		invoke.mockReset();
		// AccountProvider fetches the account on mount; unresolved auth means
		// the signed-out variant of the connect step renders.
		invoke.mockImplementation(async (command: string) => {
			if (command === "cline_account") {
				throw new Error("No Cline account auth token found");
			}
			if (command === "list_provider_catalog") {
				return {
					providers: [
						makeProvider(),
						makeProvider({ id: "openrouter", name: "OpenRouter" }),
					],
					settingsPath: "/tmp/providers.json",
				};
			}
			return {};
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	function buttonByText(text: string): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === text,
		);
		if (!button) {
			throw new Error(`button not found: ${text}`);
		}
		return button;
	}

	async function render(onComplete = vi.fn()) {
		await act(async () => {
			root.render(
				<AccountProvider>
					<OnboardingView onComplete={onComplete} />
				</AccountProvider>,
			);
		});
		return onComplete;
	}

	it("walks from welcome to the connect step", async () => {
		await render();
		expect(container.textContent).toContain("Build software your way");

		await act(async () => {
			buttonByText("Get started").click();
		});
		expect(container.textContent).toContain("Set up Cline");
		expect(container.textContent).toContain("Sign in with Cline");
		expect(container.textContent).toContain("Use your own API key");
	});

	it("completes without connecting when skipped", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		await act(async () => {
			buttonByText("Skip for now").click();
		});
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("records Cline as the provider when a signed-in user continues", async () => {
		// Simulate replaying onboarding after previously using another provider.
		window.localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify({ lastProvider: "anthropic", lastModelByProvider: {} }),
		);
		invoke.mockImplementation(async (command: string) => {
			if (command === "cline_account") {
				return { email: "dev@example.com", displayName: "Dev" };
			}
			if (command === "list_provider_catalog") {
				return { providers: [makeProvider()], settingsPath: "/tmp/p.json" };
			}
			return {};
		});
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		expect(container.textContent).toContain("Signed in as");

		await act(async () => {
			buttonByText("Continue").click();
		});
		expect(container.textContent).toContain("You're all set");
		expect(
			parseModelSelectionStorage(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
			).lastProvider,
		).toBe("cline");
	});

	it("lets the user cancel a pending browser sign-in", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		// OAuth login that never resolves (browser round-trip abandoned).
		invoke.mockImplementation(async (command: string) => {
			if (command === "run_provider_oauth_login") {
				return await new Promise(() => undefined);
			}
			if (command === "cline_account") {
				throw new Error("No Cline account auth token found");
			}
			if (command === "list_provider_catalog") {
				return { providers: [makeProvider()], settingsPath: "/tmp/p.json" };
			}
			return {};
		});
		await act(async () => {
			buttonByText("Sign in").click();
		});
		expect(container.textContent).toContain("Waiting for browser...");

		await act(async () => {
			buttonByText("Cancel").click();
		});
		expect(container.textContent).not.toContain("Waiting for browser...");
		expect(buttonByText("Sign in")).toBeDefined();
		// Cancelling must also stop the backend browser round-trip so a
		// later-completed authorization can never persist credentials.
		expect(invoke).toHaveBeenCalledWith("cancel_provider_oauth_login", {
			provider: "cline",
		});
	});

	it("connects with a Cline API key when OAuth sign-in is not used", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		await act(async () => {
			buttonByText("Use a Cline API key instead").click();
		});
		const keyInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Cline API key"]',
		);
		expect(keyInput).not.toBeNull();

		invoke.mockClear();
		invoke.mockImplementation(async (command: string) => {
			if (command === "save_provider_settings") {
				return { providerId: "cline", enabled: true };
			}
			if (command === "cline_account") {
				return { email: "dev@example.com", displayName: "Dev" };
			}
			return {};
		});

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(keyInput, "cline_key_123");
			keyInput?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			buttonByText("Connect").click();
		});

		expect(invoke).toHaveBeenCalledWith("save_provider_settings", {
			provider: "cline",
			enabled: true,
			api_key: "cline_key_123",
		});
		expect(container.textContent).toContain("You're all set");
		expect(container.textContent).toContain("Your Cline account is connected");
		expect(
			parseModelSelectionStorage(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
			).lastProvider,
		).toBe("cline");

		await act(async () => {
			buttonByText("Start building").click();
		});
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("rejects an invalid Cline API key and rolls back the saved key", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		await act(async () => {
			buttonByText("Use a Cline API key instead").click();
		});
		const keyInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Cline API key"]',
		);

		const savedKeys: Array<string | undefined> = [];
		invoke.mockClear();
		invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "save_provider_settings") {
					savedKeys.push(args?.api_key as string | undefined);
					return { providerId: "cline", enabled: true };
				}
				if (command === "cline_account") {
					throw new Error("Cline account request failed with status 401");
				}
				return {};
			},
		);

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(keyInput, "bad_key");
			keyInput?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			buttonByText("Connect").click();
		});

		// Stays on the connect step with an error instead of advancing.
		expect(container.textContent).not.toContain("You're all set");
		expect(container.textContent).toContain("Failed to save API key");
		expect(container.textContent).toContain("could not be verified");
		// The rejected key was persisted for verification, then rolled back.
		expect(savedKeys).toEqual(["bad_key", ""]);
	});

	it("saves an API key provider and remembers the selection", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		// Expand the bring-your-own-key form; drive state through the select's
		// props via the API key path (jsdom cannot open the radix listbox).
		const expandButton = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.includes("Use your own API key"),
		);
		expect(expandButton).toBeDefined();
		await act(async () => {
			expandButton?.click();
		});
		expect(container.textContent).toContain("Choose a provider");

		// Sign-in path still available alongside the expanded form.
		invoke.mockImplementation(async (command: string) => {
			if (command === "run_provider_oauth_login") {
				return { provider: "cline", accessToken: "token" };
			}
			if (command === "cline_account") {
				throw new Error("No Cline account auth token found");
			}
			return {};
		});
		await act(async () => {
			buttonByText("Sign in").click();
		});
		expect(invoke).toHaveBeenCalledWith("run_provider_oauth_login", {
			provider: "cline",
		});
		expect(container.textContent).toContain("You're all set");
		expect(
			parseModelSelectionStorage(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
			).lastProvider,
		).toBe("cline");

		await act(async () => {
			buttonByText("Start building").click();
		});
		expect(onComplete).toHaveBeenCalledTimes(1);
	});
});
