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

class StorageStub implements Storage {
	readonly #values = new Map<string, string>();
	get length() {
		return this.#values.size;
	}
	clear() {
		this.#values.clear();
	}
	getItem(key: string) {
		return this.#values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.#values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.#values.delete(key);
	}
	setItem(key: string, value: string) {
		this.#values.set(key, value);
	}
}

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
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: new StorageStub(),
		});
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

		// The welcome step layers the standalone bot over a separate interactive
		// full-bleed grid. These data attributes protect that visual composition
		// without coupling the test to generated SVG markup.
		expect(container.textContent).toContain("Build software your way");
		const welcomeBot = container.querySelector(
			'[data-welcome-hero-variant="bot-only"]',
		);
		expect(welcomeBot).not.toBeNull();
		expect(
			welcomeBot?.querySelector('[data-welcome-hero-layer="grid"]'),
		).toBeNull();
		const welcomeGrid = container.querySelector(
			'[data-onboarding-grid="welcome"] [data-welcome-hero-variant="grid-only"]',
		);
		expect(welcomeGrid).not.toBeNull();
		expect((welcomeGrid as HTMLElement).dataset.welcomeHeroLayout).toBe(
			"full-bleed",
		);
		expect((welcomeGrid as HTMLElement).dataset.welcomeHeroInteractive).toBe(
			"true",
		);

		await act(async () => {
			buttonByText("Get started").click();
		});

		// Cline is selected by default. The inactive API-key card is inert so its
		// controls cannot receive pointer or keyboard input through the overlay.
		expect(container.textContent).toContain("Set up Cline");
		const clineOption = container.querySelector(
			'[data-onboarding-option="cline"]',
		);
		const apiKeyOption = container.querySelector(
			'[data-onboarding-option="api-key"]',
		);
		const recommendedBadge = Array.from(
			container.querySelectorAll<HTMLElement>('[data-slot="badge"]'),
		).find((badge) => badge.textContent === "Recommended");
		expect(clineOption?.getAttribute("data-selected")).toBe("true");
		expect(apiKeyOption?.getAttribute("data-selected")).toBe("false");
		expect(recommendedBadge).not.toBeNull();
		// Preserve the appearance of the desktop-local Badge after decoupling
		// onboarding from the shared UI package's badge migration.
		for (const className of [
			"border-primary/30",
			"bg-primary/10",
			"text-primary-emphasis",
			"rounded-sm",
			"!pt-[0.3rem]",
			"!pb-[0.2rem]",
		]) {
			expect(recommendedBadge?.className).toContain(className);
		}
		expect(
			clineOption
				?.querySelector("[data-onboarding-option-content]")
				?.hasAttribute("inert"),
		).toBe(false);
		expect(
			apiKeyOption
				?.querySelector("[data-onboarding-option-content]")
				?.hasAttribute("inert"),
		).toBe(true);
		expect(
			container.querySelector('[data-onboarding-content="panel"]'),
		).not.toBeNull();
		const connectGrid = container.querySelector(
			'[data-welcome-hero-variant="grid-only"]',
		);
		expect(connectGrid).not.toBeNull();
		expect((connectGrid as HTMLElement).dataset.welcomeHeroLayout).toBe(
			"full-bleed",
		);
	});

	it("moves the accent selected state to the chosen setup option", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		const clineOption = container.querySelector(
			'[data-onboarding-option="cline"]',
		);
		const apiKeyOption = container.querySelector(
			'[data-onboarding-option="api-key"]',
		);
		const apiKeyForm = container.querySelector(
			"[data-onboarding-api-key-form]",
		);
		const apiKeyCardAction = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Use your own API key"]',
		);

		expect(apiKeyCardAction).not.toBeNull();
		await act(async () => {
			apiKeyCardAction?.click();
		});

		// Selecting a card moves both the visual state and the accessibility
		// boundary, expands its form, and focuses the first usable control.
		expect(clineOption?.getAttribute("data-selected")).toBe("false");
		expect(apiKeyOption?.getAttribute("data-selected")).toBe("true");
		expect(
			clineOption
				?.querySelector("[data-onboarding-option-content]")
				?.hasAttribute("inert"),
		).toBe(true);
		expect(
			apiKeyOption
				?.querySelector("[data-onboarding-option-content]")
				?.hasAttribute("inert"),
		).toBe(false);
		expect(apiKeyForm?.getAttribute("aria-hidden")).toBe("false");
		expect(document.activeElement?.getAttribute("aria-label")).toBe("Provider");
		expect(
			container.querySelector('button[aria-label="Use your own API key"]'),
		).toBeNull();

		const clineCardAction = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Sign in with Cline"]',
		);
		expect(clineCardAction).not.toBeNull();
		await act(async () => {
			clineCardAction?.click();
		});
		// Switching back performs the inverse transition and restores focus to
		// the primary Cline action.
		expect(clineOption?.getAttribute("data-selected")).toBe("true");
		expect(apiKeyOption?.getAttribute("data-selected")).toBe("false");
		expect(apiKeyForm?.getAttribute("aria-hidden")).toBe("true");
		expect(document.activeElement?.textContent?.trim()).toBe("Sign in");
		expect(
			container.querySelector('button[aria-label="Use your own API key"]'),
		).not.toBeNull();
	});

	it("keeps the Cline API key form chevron static while toggling the panel", async () => {
		await render();
		await act(async () => {
			buttonByText("Get started").click();
		});

		// The design uses the chevron as a disclosure affordance without rotating
		// it; aria-expanded and panel visibility carry the actual state.
		const trigger = buttonByText("Use a Cline API key");
		const chevron = trigger.querySelector("svg");
		const chevronClassName = chevron?.getAttribute("class");
		const panel = container.querySelector("#onboarding-cline-key-form");

		expect(trigger.getAttribute("aria-controls")).toBe(
			"onboarding-cline-key-form",
		);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(chevronClassName).toBeTruthy();
		expect(panel?.getAttribute("aria-hidden")).toBe("true");

		await act(async () => {
			trigger.click();
		});

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(chevron?.getAttribute("class")).toBe(chevronClassName);
		expect(panel?.getAttribute("aria-hidden")).toBe("false");

		await act(async () => {
			trigger.click();
		});

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(chevron?.getAttribute("class")).toBe(chevronClassName);
		expect(panel?.getAttribute("aria-hidden")).toBe("true");
	});

	it("completes without connecting when skipped", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		await act(async () => {
			buttonByText("Skip").click();
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
		// The redesigned completion step places transparent content over a static,
		// wide version of the hero grid.
		expect(container.textContent).toContain("You're all set");
		const doneGrid = container.querySelector<HTMLElement>(
			'[data-welcome-hero-variant="grid-only"]',
		);
		expect(doneGrid?.dataset.welcomeHeroInteractive).toBe("false");
		expect(doneGrid?.dataset.welcomeHeroLayout).toBe("wide-grid");
		expect(
			container.querySelector('[data-welcome-hero-layer="bot-fill"]'),
		).toBeNull();
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
			buttonByText("Use a Cline API key").click();
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
			buttonByText("Use a Cline API key").click();
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

	it("keeps Cline sign-in available while API-key setup is expanded", async () => {
		const onComplete = await render();
		await act(async () => {
			buttonByText("Get started").click();
		});
		// Expand the bring-your-own-key form; drive state through the select's
		// props via the API key path (jsdom cannot open the radix listbox).
		const expandButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Use your own API key"]',
		);
		expect(expandButton).toBeDefined();
		await act(async () => {
			expandButton?.click();
		});
		expect(container.textContent).toContain("Choose a provider");

		// Expanding bring-your-own-key changes the selected card, but the user can
		// still switch back and finish through the Cline OAuth path.
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Sign in with Cline"]',
				)
				?.click();
		});
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
