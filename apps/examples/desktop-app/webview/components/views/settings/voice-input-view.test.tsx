// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import { defaultTranscriptionModel, VoiceInputContent } from "./voice-input-view";

const { fetchProviderCatalogMock, invokeMock, notifyMock } = vi.hoisted(() => ({
	fetchProviderCatalogMock: vi.fn(),
	invokeMock: vi.fn(),
	notifyMock: vi.fn(),
}));

vi.mock("@/lib/provider-model-catalog", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/provider-model-catalog")>();
	return {
		...actual,
		fetchProviderCatalog: fetchProviderCatalogMock,
		notifyVoiceInputSettingsChanged: notifyMock,
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
	it("prefers streaming models, then the first transcription model", () => {
		expect(
			defaultTranscriptionModel(transcriptionProvider.modelList ?? [])?.id,
		).toBe("scribe_v2_realtime");
		expect(
			defaultTranscriptionModel([
				{ id: "batch-only", name: "Batch", operation: "transcription" },
			])?.id,
		).toBe("batch-only");
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
		invokeMock.mockReset();
		notifyMock.mockReset();
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

	it("locks the page until a voice-capable provider is connected", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [unconnectedProvider],
			settingsPath: "/tmp/providers.json",
		});
		const onOpenModelProviders = await render();

		expect(container.textContent).toContain(
			"Voice input needs a configured model provider",
		);
		const openProviders = Array.from(
			container.querySelectorAll("button"),
		).find((button) => button.textContent?.includes("Open Model Providers"));
		await act(async () => openProviders?.click());
		expect(onOpenModelProviders).toHaveBeenCalledOnce();
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
			"None of your configured providers offer speech-to-text models",
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

		const toggle = container.querySelector<HTMLButtonElement>(
			'[aria-label="Enable voice input"]',
		);
		expect(toggle?.getAttribute("aria-checked")).toBe("false");
		await act(async () => toggle?.click());

		expect(invokeMock).toHaveBeenCalledWith("save_voice_input_settings", {
			provider: "elevenlabs",
			model: "scribe_v2_realtime",
		});
		expect(notifyMock).toHaveBeenCalled();
		const selected = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(selected?.textContent).toContain("Scribe v2 Realtime");
		expect(selected?.textContent).toContain("Default");
	});

	it("saves model changes and clears the selection when disabled", async () => {
		fetchProviderCatalogMock.mockResolvedValue({
			providers: [transcriptionProvider],
			settingsPath: "/tmp/providers.json",
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2_realtime" },
		});
		invokeMock.mockResolvedValue({
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v1" },
		});
		await render();

		const batchModel = Array.from(
			container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
		).find((button) => button.textContent?.includes("Scribe v1"));
		await act(async () => batchModel?.click());
		expect(invokeMock).toHaveBeenLastCalledWith("save_voice_input_settings", {
			provider: "elevenlabs",
			model: "scribe_v1",
		});

		invokeMock.mockResolvedValue({});
		const toggle = container.querySelector<HTMLButtonElement>(
			'[aria-label="Enable voice input"]',
		);
		await act(async () => toggle?.click());
		expect(invokeMock).toHaveBeenLastCalledWith("save_voice_input_settings", {
			provider: undefined,
			model: undefined,
		});
	});
});
