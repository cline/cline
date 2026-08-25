import type { ProviderModesSettings } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const coreMocks = vi.hoisted(() => ({
	ensureCustomProvidersLoaded: vi.fn(),
	initializeModesIfMissing: vi.fn(),
	listLocalProviders: vi.fn(),
	providerRead: vi.fn(),
	readClientSettings: vi.fn(),
	saveLocalProviderSettings: vi.fn(),
	saveModeSettings: vi.fn(),
	setModeSettings: vi.fn(),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClientSettingsManager: class {
			initializeModesIfMissing = coreMocks.initializeModesIfMissing;
			read = coreMocks.readClientSettings;
			setModeSettings = coreMocks.setModeSettings;
		},
		ensureCustomProvidersLoaded: coreMocks.ensureCustomProvidersLoaded,
		listLocalProviders: coreMocks.listLocalProviders,
		ProviderSettingsManager: class {
			read = coreMocks.providerRead;
		},
		saveLocalProviderSettings: coreMocks.saveLocalProviderSettings,
		saveModeSettings: coreMocks.saveModeSettings,
	};
});

import { handleCommand } from "./commands";

function createContext(): SidecarContext {
	return {
		logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn() },
		wsClients: new Set(),
	} as unknown as SidecarContext;
}

let storedModes: ProviderModesSettings;
let clientSettingsInitialized: boolean;

beforeEach(() => {
	storedModes = {};
	clientSettingsInitialized = false;
	for (const mock of Object.values(coreMocks)) mock.mockReset();
	coreMocks.providerRead.mockReturnValue({ modes: {} });
	coreMocks.initializeModesIfMissing.mockImplementation(
		(modes: ProviderModesSettings) => {
			if (!clientSettingsInitialized) {
				storedModes = { ...modes };
				clientSettingsInitialized = true;
			}
			return { version: 1, modes: storedModes };
		},
	);
	coreMocks.readClientSettings.mockImplementation(() => ({
		version: 1,
		modes: storedModes,
	}));
	coreMocks.setModeSettings.mockImplementation(
		(mode: keyof ProviderModesSettings, settings: unknown) => {
			storedModes = { ...storedModes };
			if (settings) storedModes[mode] = settings as never;
			else delete storedModes[mode];
			return { version: 1, modes: storedModes };
		},
	);
	coreMocks.saveModeSettings.mockImplementation(
		async (
			_manager: unknown,
			request: { mode: keyof ProviderModesSettings; settings?: unknown },
			store: { setModeSettings: (mode: string, settings: unknown) => unknown },
		) => {
			store.setModeSettings(request.mode, request.settings);
			return { settingsPath: "/tmp/client-settings.json", modes: storedModes };
		},
	);
	coreMocks.listLocalProviders.mockImplementation(
		async (
			_manager: unknown,
			options: { modeSettings: ProviderModesSettings },
		) => ({ providers: [], modes: options.modeSettings }),
	);
});

describe("desktop provider mode commands", () => {
	it("persists Voice settings in the same client store used by the catalog", async () => {
		const ctx = createContext();
		const selection = { providerId: "groq", modelId: "whisper-large-v3" };

		const saved = await handleCommand(ctx, "save_voice_input_settings", {
			provider: selection.providerId,
			model: selection.modelId,
		});
		const catalog = (await handleCommand(ctx, "list_provider_catalog")) as {
			modes: ProviderModesSettings;
		};

		expect(coreMocks.saveModeSettings).toHaveBeenCalledWith(
			expect.anything(),
			{ mode: "voiceInput", settings: selection },
			expect.objectContaining({
				read: coreMocks.readClientSettings,
				setModeSettings: coreMocks.setModeSettings,
			}),
		);
		expect(saved).toMatchObject({ voiceInput: selection });
		expect(catalog.modes.voiceInput).toEqual(selection);
	});

	it("durably clears every mode that references a disconnected provider", async () => {
		const legacyModes: ProviderModesSettings = {
			voiceInput: { providerId: "openai", modelId: "whisper-1" },
			voiceOutput: { providerId: "openai", modelId: "gpt-4o-mini-tts" },
			realtimeVoice: { providerId: "openai", modelId: "gpt-realtime" },
		};
		coreMocks.providerRead.mockReturnValue({ modes: legacyModes });
		coreMocks.saveLocalProviderSettings.mockReturnValue({
			providerId: "openai",
			enabled: false,
			settingsPath: "/tmp/providers.json",
		});

		await handleCommand(createContext(), "save_provider_settings", {
			provider: "openai",
			enabled: false,
		});
		const catalog = (await handleCommand(
			createContext(),
			"list_provider_catalog",
		)) as { modes: ProviderModesSettings };

		expect(coreMocks.setModeSettings.mock.calls).toEqual([
			["voiceInput", undefined],
			["voiceOutput", undefined],
			["realtimeVoice", undefined],
		]);
		expect(coreMocks.initializeModesIfMissing).toHaveBeenCalledWith(
			legacyModes,
		);
		expect(catalog.modes).toEqual({});
	});
});
