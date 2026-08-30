// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";

const { loadProviderModelsMock } = vi.hoisted(() => ({
	loadProviderModelsMock: vi.fn(),
}));

vi.mock("@/lib/provider-model-catalog", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/provider-model-catalog")>();
	return { ...actual, loadProviderModels: loadProviderModelsMock };
});

const provider: Provider = {
	id: "ollama",
	name: "Ollama",
	models: 2,
	color: "#000",
	letter: "OL",
	enabled: true,
	modelList: [
		{ id: "alpha", name: "Alpha" },
		{ id: "beta", name: "Beta" },
	],
};

describe("ProviderDetailContent models", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("persists favorites, sorts them first, and adds models", async () => {
		const onUpdateModels = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					modelsError={null}
					onBack={vi.fn()}
					onLoadModels={vi.fn()}
					onUpdate={vi.fn()}
					onUpdateModels={onUpdateModels}
					provider={provider}
				/>,
			);
		});

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Favorite Beta"]')
				?.click();
		});
		expect(
			Array.from(
				container.querySelectorAll<HTMLButtonElement>(
					'[aria-label^="Copy model ID"]',
				),
			).map((button) => button.getAttribute("aria-label")),
		).toEqual(["Copy model ID beta", "Copy model ID alpha"]);
		expect(
			container.querySelector('[aria-label="Unfavorite Beta"] svg')?.classList,
		).toContain("fill-current");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Add model"]')
				?.click();
		});
		const input = container.querySelector<HTMLInputElement>(
			'[aria-label="New model ID"]',
		);
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "gamma");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="New model ID"] + button',
				)
				?.click();
		});
		expect(onUpdateModels).toHaveBeenCalledWith(["alpha", "beta", "gamma"]);
	});
});

const catalogProviders: Provider[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		models: 4,
		color: "#000000",
		letter: "AN",
		enabled: true,
		apiKey: "sk-test",
		capabilities: ["popular"],
		modelList: [],
	},
	{
		id: "cline",
		name: "Cline",
		models: 12,
		color: "#000000",
		letter: "CL",
		enabled: false,
		capabilities: ["oauth", "popular"],
		modelList: [],
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		models: 1,
		color: "#000000",
		letter: "EL",
		enabled: false,
		modelList: [],
	},
];

describe("ProviderListContent", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	});

	it("groups providers into Configured, Popular, and All providers", async () => {
		const onConfigure = vi.fn();
		await act(async () => {
			root.render(
				<ProviderListContent
					onAddProvider={vi.fn()}
					onConfigure={onConfigure}
					providers={catalogProviders}
				/>,
			);
		});

		const headings = Array.from(container.querySelectorAll("h2")).map(
			(heading) => heading.textContent,
		);
		expect(headings).toEqual(["Configured", "Popular", "All providers"]);
		// No per-provider enable toggles anymore.
		expect(container.querySelector('[role="switch"]')).toBeNull();
		expect(container.textContent).toContain("1 configured");

		const rows = Array.from(container.querySelectorAll("button")).filter(
			(button) => button.textContent?.includes("Anthropic"),
		);
		await act(async () => rows[0]?.click());
		expect(onConfigure).toHaveBeenCalledWith("anthropic");
	});

	it("shows connection status and auth kind per row", async () => {
		await act(async () => {
			root.render(
				<ProviderListContent
					onAddProvider={vi.fn()}
					onConfigure={vi.fn()}
					providers={catalogProviders}
				/>,
			);
		});

		const rowFor = (name: string) =>
			Array.from(container.querySelectorAll("button")).find((button) =>
				button.textContent?.includes(name),
			);
		expect(rowFor("Anthropic")?.textContent).toContain("Configured");
		expect(rowFor("Cline")?.textContent).toContain("Sign in");
		expect(rowFor("ElevenLabs")?.textContent).toContain("API key");
	});

	it("filters providers by search across every group", async () => {
		await act(async () => {
			root.render(
				<ProviderListContent
					onAddProvider={vi.fn()}
					onConfigure={vi.fn()}
					providers={catalogProviders}
				/>,
			);
		});

		const search = container.querySelector<HTMLInputElement>(
			'[aria-label="Search model providers"]',
		);
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(search, "eleven");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(container.textContent).toContain("ElevenLabs");
		expect(container.textContent).not.toContain("Anthropic");
	});
});

describe("ProviderDetailContent auth flows", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		// "cline" is a featured provider, so mounting its detail refreshes the
		// model list; resolve it to keep the auth assertions deterministic.
		loadProviderModelsMock.mockReset().mockResolvedValue([]);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	});

	const signInProvider: Provider = {
		id: "cline",
		name: "Cline",
		models: 0,
		color: "#000",
		letter: "CL",
		enabled: false,
		capabilities: ["oauth"],
		configFields: [
			{
				path: "apiKey",
				label: "API Key",
				type: "password",
				secret: true,
			},
		],
		modelList: [],
	};

	it("shows browser sign-in instead of an API key field for OAuth providers", async () => {
		const onOAuthLogin = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onOAuthLogin={onOAuthLogin}
					onUpdate={vi.fn()}
					provider={signInProvider}
				/>,
			);
		});

		expect(container.textContent).toContain("Sign in with browser");
		expect(container.textContent).toContain("Not configured");
		// The API key input stays collapsed until explicitly requested.
		expect(container.querySelector('input[type="password"]')).toBeNull();

		const signIn = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Sign in with browser"),
		);
		await act(async () => signIn?.click());
		expect(onOAuthLogin).toHaveBeenCalledOnce();

		const manualKey = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Use an API key instead"),
		);
		await act(async () => manualKey?.click());
		expect(container.querySelector('input[type="password"]')).not.toBeNull();
	});

	it("offers sign out when OAuth is connected", async () => {
		const onDisconnect = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onDisconnect={onDisconnect}
					onUpdate={vi.fn()}
					provider={{
						...signInProvider,
						enabled: true,
						oauthAccessTokenPresent: true,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Signed in via browser");
		expect(container.textContent).toContain("Configured");
		const signOut = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Sign out",
		);
		await act(async () => signOut?.click());
		expect(onDisconnect).toHaveBeenCalledOnce();
	});

	it("offers connect and disconnect for API-key providers", async () => {
		const onConnect = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onConnect={onConnect}
					onUpdate={vi.fn()}
					provider={{ ...provider, enabled: false }}
				/>,
			);
		});
		const connect = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Connect",
		);
		await act(async () => connect?.click());
		expect(onConnect).toHaveBeenCalledOnce();

		const onDisconnect = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onDisconnect={onDisconnect}
					onUpdate={vi.fn()}
					provider={{ ...provider, apiKey: "sk-test" }}
				/>,
			);
		});
		const disconnect = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Disconnect",
		);
		await act(async () => disconnect?.click());
		expect(onDisconnect).toHaveBeenCalledOnce();
	});
});

describe("ProviderDetailContent audio capabilities", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("shows audio icons beside transcription-capable models", async () => {
		const provider: Provider = {
			id: "capability-provider",
			name: "Capability Provider",
			models: 2,
			color: "#000000",
			letter: "CP",
			enabled: true,
			modelList: [
				{
					id: "audio-input",
					name: "Audio Input",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
				{
					id: "chat",
					name: "Chat",
					inputModalities: ["text"],
					outputModalities: ["text"],
				},
			],
		};

		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onUpdate={vi.fn()}
					provider={provider}
				/>,
			);
		});

		expect(
			container.querySelectorAll(
				'[role="img"][aria-label="Audio support"] .lucide-mic',
			),
		).toHaveLength(1);
	});

	it("scopes the fetched featured list to its provider and list revision", async () => {
		const clineProvider: Provider = {
			id: "cline",
			name: "Cline",
			models: 1,
			color: "#000",
			letter: "CL",
			enabled: true,
			modelList: [{ id: "cline/snapshot-model", name: "Cline Snapshot" }],
		};
		const clinePassProvider: Provider = {
			id: "cline-pass",
			name: "ClinePass",
			models: 1,
			color: "#000",
			letter: "CP",
			enabled: true,
			modelList: [{ id: "pass/snapshot-model", name: "Pass Snapshot" }],
		};
		const render = (detailProvider: Provider) =>
			act(async () => {
				root.render(
					<ProviderDetailContent
						onBack={vi.fn()}
						onUpdate={vi.fn()}
						provider={detailProvider}
					/>,
				);
				await Promise.resolve();
			});

		let resolvePassModels: (models: unknown[]) => void = () => {};
		loadProviderModelsMock.mockReset().mockImplementation((id: string) =>
			id === "cline"
				? Promise.resolve([
						{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
					])
				: new Promise((resolve) => {
						resolvePassModels = resolve;
					}),
		);

		await render(clineProvider);
		expect(container.textContent).toContain("Claude Opus 5");

		// Switching directly to the other featured provider must not keep
		// showing the previous provider's fetched models while its own
		// request is still pending — the same component instance is reused.
		await render(clinePassProvider);
		expect(container.textContent).not.toContain("Claude Opus 5");
		expect(container.textContent).toContain("Pass Snapshot");

		await act(async () => {
			resolvePassModels([{ id: "openai/gpt-5", name: "GPT-5" }]);
			await Promise.resolve();
		});
		expect(container.textContent).toContain("GPT-5");
		expect(container.textContent).not.toContain("Pass Snapshot");
	});

	it("keeps the catalog snapshot when the refresh after a switch fails or is empty", async () => {
		const clineProvider: Provider = {
			id: "cline",
			name: "Cline",
			models: 1,
			color: "#000",
			letter: "CL",
			enabled: true,
			modelList: [{ id: "cline/snapshot-model", name: "Cline Snapshot" }],
		};
		const clinePassProvider: Provider = {
			id: "cline-pass",
			name: "ClinePass",
			models: 1,
			color: "#000",
			letter: "CP",
			enabled: true,
			modelList: [{ id: "pass/snapshot-model", name: "Pass Snapshot" }],
		};
		const render = (detailProvider: Provider) =>
			act(async () => {
				root.render(
					<ProviderDetailContent
						onBack={vi.fn()}
						onUpdate={vi.fn()}
						provider={detailProvider}
					/>,
				);
				await Promise.resolve();
			});

		loadProviderModelsMock
			.mockReset()
			.mockImplementation((id: string) =>
				id === "cline"
					? Promise.resolve([
							{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
						])
					: Promise.reject(new Error("offline")),
			);
		await render(clineProvider);
		expect(container.textContent).toContain("Claude Opus 5");

		// A failed refresh after switching falls back to the new provider's
		// snapshot; the previous provider's fetched list must not survive.
		await render(clinePassProvider);
		expect(container.textContent).not.toContain("Claude Opus 5");
		expect(container.textContent).toContain("Pass Snapshot");

		// Same for an empty refresh result (a fresh list revision, so the
		// earlier successful cline fetch no longer applies).
		loadProviderModelsMock.mockReset().mockResolvedValue([]);
		await render({
			...clineProvider,
			modelList: [{ id: "cline/snapshot-model", name: "Cline Snapshot" }],
		});
		expect(container.textContent).not.toContain("GPT-5");
		expect(container.textContent).toContain("Cline Snapshot");
	});

	it("reflects same-provider model list updates instead of shadowing them", async () => {
		loadProviderModelsMock
			.mockReset()
			.mockResolvedValue([
				{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
			]);
		const baseProvider: Provider = {
			id: "cline",
			name: "Cline",
			models: 1,
			color: "#000",
			letter: "CL",
			enabled: true,
			modelList: [{ id: "cline/snapshot-model", name: "Cline Snapshot" }],
		};
		const render = (detailProvider: Provider) =>
			act(async () => {
				root.render(
					<ProviderDetailContent
						onBack={vi.fn()}
						onUpdate={vi.fn()}
						provider={detailProvider}
					/>,
				);
				await Promise.resolve();
			});

		await render(baseProvider);
		expect(container.textContent).toContain("Claude Opus 5");

		// The parent refreshed the provider's list (e.g. after an update):
		// the stale fetched copy must not shadow it, and the list is
		// re-fetched for the new revision.
		loadProviderModelsMock.mockResolvedValue([
			{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
			{ id: "custom/new-model", name: "Custom New Model" },
		]);
		await render({
			...baseProvider,
			modelList: [
				{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
				{ id: "custom/new-model", name: "Custom New Model" },
			],
		});
		expect(container.textContent).toContain("Custom New Model");
	});

	it("does not drop earlier additions on consecutive model adds", async () => {
		loadProviderModelsMock
			.mockReset()
			.mockResolvedValue([
				{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
			]);
		const onUpdateModels = vi.fn();
		const baseProvider: Provider = {
			id: "cline",
			name: "Cline",
			models: 1,
			color: "#000",
			letter: "CL",
			enabled: true,
			modelList: [{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" }],
		};
		const render = (detailProvider: Provider) =>
			act(async () => {
				root.render(
					<ProviderDetailContent
						onBack={vi.fn()}
						onUpdate={vi.fn()}
						onUpdateModels={onUpdateModels}
						provider={detailProvider}
					/>,
				);
				await Promise.resolve();
			});
		const addModel = async (modelId: string) => {
			await act(async () => {
				container
					.querySelector<HTMLButtonElement>('[aria-label="Add model"]')
					?.click();
			});
			const input = container.querySelector<HTMLInputElement>(
				'[aria-label="New model ID"]',
			);
			await act(async () => {
				const setter = Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(input, modelId);
				input?.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await act(async () => {
				container
					.querySelector<HTMLButtonElement>(
						'[aria-label="New model ID"] + button',
					)
					?.click();
			});
		};

		await render(baseProvider);
		await addModel("custom/one");
		expect(onUpdateModels).toHaveBeenLastCalledWith([
			"anthropic/claude-opus-5",
			"custom/one",
		]);

		// The parent applies the update and hands back the new list (as
		// settings-view does after update_provider_models + reload).
		loadProviderModelsMock.mockResolvedValue([
			{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
			{ id: "custom/one", name: "custom/one" },
		]);
		await render({
			...baseProvider,
			modelList: [
				{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
				{ id: "custom/one", name: "custom/one" },
			],
		});

		// The second addition must include the first one — the stale fetched
		// list used to shadow the update and submit a list without it.
		await addModel("custom/two");
		expect(onUpdateModels).toHaveBeenLastCalledWith([
			"anthropic/claude-opus-5",
			"custom/one",
			"custom/two",
		]);
	});

	it("refreshes featured providers and renders tier badges and descriptions", async () => {
		loadProviderModelsMock.mockReset().mockResolvedValue([
			{
				id: "anthropic/claude-opus-5",
				name: "Claude Opus 5",
				description: "Most intelligent model",
				featured: { tier: "recommended", rank: 0, tags: ["NEW"] },
			},
			{
				id: "deepseek/deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				featured: { tier: "free", rank: 0, tags: [] },
			},
			{ id: "vendor/plain-model", name: "Plain Model" },
		]);
		const clineProvider: Provider = {
			id: "cline",
			name: "Cline",
			models: 1,
			color: "#000",
			letter: "CL",
			enabled: true,
			// Stale catalog snapshot; the refreshed list must replace it.
			modelList: [{ id: "old/stale-model", name: "Stale Model" }],
		};

		await act(async () => {
			root.render(
				<ProviderDetailContent
					onBack={vi.fn()}
					onUpdate={vi.fn()}
					provider={clineProvider}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(loadProviderModelsMock).toHaveBeenCalledWith("cline");
		expect(container.textContent).not.toContain("Stale Model");
		expect(container.textContent).toContain("Claude Opus 5");
		expect(container.textContent).toContain("Most intelligent model");
		const badgeTexts = Array.from(
			container.querySelectorAll(".uppercase.tracking-wide"),
		).map((badge) => badge.textContent);
		expect(badgeTexts).toEqual(["Recommended", "NEW", "Free"]);
	});
});
