// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import {
	defaultTranscriptionModel,
	VoiceInputContent,
} from "./voice-input-view";

const {
	fetchProviderCatalogMock,
	loadTranscriptionModelsMock,
	invokeMock,
	notifyMock,
	readVoiceInputCatalogMock,
} = vi.hoisted(() => ({
	loadTranscriptionModelsMock: vi.fn(),
	fetchProviderCatalogMock: vi.fn(),
	invokeMock: vi.fn(),
	notifyMock: vi.fn(),
	readVoiceInputCatalogMock: vi.fn(),
}));

vi.mock("@/lib/provider-model-catalog", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/provider-model-catalog")>();
	return {
		...actual,
		fetchProviderCatalog: fetchProviderCatalogMock,
		loadTranscriptionModels: loadTranscriptionModelsMock,
		notifyVoiceInputSettingsChanged: notifyMock,
		readVoiceInputCatalog: readVoiceInputCatalogMock,
	};
});

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
	openExternalUrl: vi.fn(),
}));

const transcriptionProvider: Provider = {
	id: "elevenlabs",
	name: "ElevenLabs",
	models: 2,
	color: "#000000",
	letter: "EL",
	enabled: true,
	apiKey: "sk-test",
	modelList: [
		{
			id: "scribe_v1",
			name: "Scribe v1",
			operation: "transcription",
			inputModalities: ["audio"],
			outputModalities: ["text"],
		},
		{
			id: "scribe_v2_realtime",
			name: "Scribe v2 Realtime",
			operation: "transcription",
			operationModes: ["streaming"],
			inputModalities: ["audio"],
			outputModalities: ["text"],
		},
	],
};

const unconnectedProvider: Provider = {
	...transcriptionProvider,
	id: "groq",
	name: "Groq",
	enabled: false,
	apiKey: undefined,
};

describe("defaultTranscriptionModel", () => {
	it("only selects streaming transcription models", () => {
		expect(
			defaultTranscriptionModel(transcriptionProvider.modelList ?? [])?.id,
		).toBe("scribe_v2_realtime");
		expect(
			defaultTranscriptionModel([
				{
					inputModalities: ["audio"],
					outputModalities: ["text"],
					id: "batch-only",
					name: "Batch",
					operation: "transcription",
				},
			])?.id,
		).toBeUndefined();
	});
});

describe("VoiceInputContent", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchProviderCatalogMock.mockReset();
		loadTranscriptionModelsMock
			.mockReset()
			.mockImplementation(async (id: string) =>
				id === "elevenlabs" ? transcriptionProvider.modelList : [],
			);
		invokeMock.mockReset();
		notifyMock.mockReset();
		readVoiceInputCatalogMock.mockReset().mockReturnValue(null);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	const render = async (onOpenModelProviders = vi.fn()) => {
		await act(async () => {
			root.render(
				<VoiceInputContent onOpenModelProviders={onOpenModelProviders} />,
			);
		});
		return onOpenModelProviders;
	};

	it("offers every connected provider with verified streaming models, including native OpenAI", async () => {
		const native = {
			...transcriptionProvider,
			id: "openai-native",
			name: "OpenAI Native",
		};
		const custom = {
			...transcriptionProvider,
			id: "custom-streaming",
			name: "Custom Streaming",
		};
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [native, transcriptionProvider, custom],
			voiceInput: {
				providerId: "openai-native",
				modelId: "gpt-realtime-whisper",
			},
		});
		loadTranscriptionModelsMock.mockResolvedValue([
			{
				id: "gpt-realtime-whisper",
				name: "Live transcription",
				operation: "transcription",
				operationModes: ["streaming"],
				inputModalities: ["audio"],
				outputModalities: ["text"],
			},
		]);
		await render();
		for (const name of ["OpenAI Native", "ElevenLabs", "Custom Streaming"])
			expect(container.textContent).toContain(name);
	});

	it("renders the verified snapshot immediately while refreshing after navigation", async () => {
		readVoiceInputCatalogMock.mockReturnValue({
			providers: [transcriptionProvider],
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2_realtime" },
		});
		fetchProviderCatalogMock.mockReturnValue(new Promise(() => {}));
		await render();
		expect(container.textContent).not.toContain("Loading providers");
		expect(container.textContent).toContain("Scribe v2 Realtime");
		expect(
			container.querySelector('[role="radio"][aria-checked="true"]')
				?.textContent,
		).toContain("Scribe v2 Realtime");
	});

	it("locks the page until a voice-capable provider is connected", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [unconnectedProvider],
			settingsPath: "/tmp/providers.json",
		});
		const onOpenModelProviders = await render();

		expect(container.textContent).toContain(
			"Voice input needs a configured model provider",
		);
		const openProviders = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Open Model Providers"),
		);
		await act(async () => openProviders?.click());
		expect(onOpenModelProviders).toHaveBeenCalledOnce();
	});

	it("renders only verified transcription models and uses their current execution modes", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [
				{
					...transcriptionProvider,
					id: "vercel-ai-gateway",
					name: "Vercel AI Gateway",
					modelList: [
						{
							inputModalities: ["audio"],
							outputModalities: ["text"],
							id: "stale",
							name: "Removed model",
							operation: "transcription",
						},
					],
				},
			],
			voiceInput: { providerId: "vercel-ai-gateway", modelId: "live" },
		});
		loadTranscriptionModelsMock.mockResolvedValue([
			{
				inputModalities: ["audio"],
				outputModalities: ["text"],
				id: "live",
				name: "Verified live model",
				operation: "transcription",
				operationModes: ["streaming"],
			},
			{ id: "chat-transcribe", name: "Chat transcribe", operation: "language" },
		]);
		await render();
		expect(container.textContent).toContain("Verified live model");
		expect(container.textContent).not.toContain("Removed model");
		expect(container.textContent).not.toContain("Chat transcribe");
		expect(container.querySelector('[role="radio"]')?.textContent).toContain(
			"Realtime",
		);
	});

	it("hides unverified models on discovery failure and keeps other providers usable", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [
				transcriptionProvider,
				{
					...transcriptionProvider,
					id: "vercel-ai-gateway",
					name: "Vercel AI Gateway",
				},
			],
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2_realtime" },
		});
		loadTranscriptionModelsMock.mockImplementation(async (id: string) => {
			if (id === "vercel-ai-gateway") throw new Error("offline");
			return transcriptionProvider.modelList;
		});
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not verify voice models for Vercel AI Gateway",
		);
		expect(container.querySelectorAll('[role="radio"]').length).toBe(1);
		expect(
			Array.from(container.querySelectorAll("button")).some(
				(button) => button.textContent === "Vercel AI Gateway",
			),
		).toBe(false);
	});

	it("explains when connected providers offer no transcription models", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [
				{
					...transcriptionProvider,
					id: "anthropic",
					name: "Anthropic",
					modelList: [{ id: "claude", name: "Claude" }],
				},
				unconnectedProvider,
			],
			settingsPath: "/tmp/providers.json",
		});
		await render();

		expect(container.textContent).toContain(
			"None of your configured providers offer streaming speech-to-text models",
		);
		expect(container.textContent).toContain("Groq");
	});

	it("enables voice input with the default (streaming) model preselected", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [transcriptionProvider],
			settingsPath: "/tmp/providers.json",
		});
		invokeMock.mockResolvedValue({
			voiceInput: {
				providerId: "elevenlabs",
				modelId: "scribe_v2_realtime",
			},
		});
		await render();

		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable voice input"]',
		);
		expect(toggle?.checked).toBe(false);
		await act(async () => toggle?.click());

		expect(invokeMock).toHaveBeenCalledWith("save_voice_input_settings", {
			provider: "elevenlabs",
			model: "scribe_v2_realtime",
		});
		expect(notifyMock).toHaveBeenCalled();
		const selected = container.querySelector(
			'[role="radio"][aria-checked="true"]',
		);
		expect(selected?.textContent).toContain("Scribe v2 Realtime");
		expect(selected?.textContent).toContain("Default");
	});

	it("excludes batch models and clears the selection when disabled", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [transcriptionProvider],
			settingsPath: "/tmp/providers.json",
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2_realtime" },
		});
		invokeMock.mockResolvedValue({
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2_realtime" },
		});
		await render();

		expect(container.textContent).not.toContain("Scribe v1");

		invokeMock.mockResolvedValue({});
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable voice input"]',
		);
		await act(async () => toggle?.click());
		expect(invokeMock).toHaveBeenLastCalledWith("save_voice_input_settings", {
			provider: undefined,
			model: undefined,
		});
	});
});
