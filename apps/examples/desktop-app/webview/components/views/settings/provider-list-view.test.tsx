// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider, VoiceInputSelection } from "@/lib/provider-schema";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";

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

const voiceProviders: Provider[] = [
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		models: 1,
		color: "#000000",
		letter: "EL",
		enabled: true,
		modelList: [
			{
				id: "scribe_v2",
				name: "Scribe v2",
				operation: "transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			},
		],
	},
	{
		id: "groq",
		name: "Groq",
		models: 3,
		color: "#000000",
		letter: "GR",
		enabled: true,
		modelList: [
			{
				id: "whisper-large-v3",
				name: "Whisper Large v3",
				operation: "transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			},
			{
				id: "whisper-large-v3-turbo",
				name: "Whisper Large v3 Turbo",
				operation: "transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			},
			{
				id: "llama-chat",
				name: "Llama Chat",
				inputModalities: ["text"],
				outputModalities: ["text"],
			},
		],
	},
];

describe("ProviderListContent voice input settings", () => {
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

	it("lets the user choose and clear the voice provider and model", async () => {
		const onVoiceInputChange = vi.fn();
		let selection: VoiceInputSelection | undefined = {
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		};
		const render = async () => {
			await act(async () => {
				root.render(
					<ProviderListContent
						onAddProvider={vi.fn()}
						onConfigure={vi.fn()}
						onToggle={vi.fn()}
						onVoiceInputChange={onVoiceInputChange}
						providers={voiceProviders}
						voiceInput={selection}
					/>,
				);
			});
		};

		await render();
		const providerSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Voice input provider"]',
		);
		const modelSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Voice input model"]',
		);
		expect(providerSelect?.value).toBe("elevenlabs");
		expect(modelSelect?.value).toBe("scribe_v2");

		await act(async () => {
			if (!providerSelect) return;
			providerSelect.value = "groq";
			providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onVoiceInputChange).toHaveBeenLastCalledWith({
			providerId: "groq",
			modelId: "whisper-large-v3",
		});

		selection = {
			providerId: "groq",
			modelId: "whisper-large-v3",
		};
		await render();
		const groqModelSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Voice input model"]',
		);
		await act(async () => {
			if (!groqModelSelect) return;
			groqModelSelect.value = "whisper-large-v3-turbo";
			groqModelSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onVoiceInputChange).toHaveBeenLastCalledWith({
			providerId: "groq",
			modelId: "whisper-large-v3-turbo",
		});

		const groqProviderSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Voice input provider"]',
		);
		await act(async () => {
			if (!groqProviderSelect) return;
			groqProviderSelect.value = "";
			groqProviderSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onVoiceInputChange).toHaveBeenLastCalledWith(undefined);
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
});
