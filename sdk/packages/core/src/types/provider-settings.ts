import type {
	ProviderMode,
	ProviderModeSettingsMap,
	ProviderModesSettings,
	RealtimeVoiceModeSettings,
	VoiceInputModeSettings,
	VoiceOutputModeSettings,
} from "@cline/shared";
import { PROVIDER_MODE_IDS } from "@cline/shared";
import { z } from "zod";
import {
	type ProviderClient,
	type ProviderConfig,
	type ProviderProtocol,
	type ProviderSettings,
	ProviderSettingsSchema,
	type ToProviderConfigOptions,
	toProviderConfig,
} from "../services/llms/provider-settings";

export type {
	ProviderClient,
	ProviderConfig,
	ProviderProtocol,
	ProviderSettings,
	ToProviderConfigOptions,
};
export const ProviderSettingsSchemaTyped: z.ZodType<ProviderSettings> =
	ProviderSettingsSchema;
export { toProviderConfig };

export type ProviderTokenSource = "manual" | "oauth" | "migration";

export const VoiceInputModeSettingsSchema: z.ZodType<VoiceInputModeSettings> =
	z.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	});

export const VoiceOutputModeSettingsSchema: z.ZodType<VoiceOutputModeSettings> =
	z.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
		voice: z.string().min(1).optional(),
	});

export const RealtimeVoiceModeSettingsSchema: z.ZodType<RealtimeVoiceModeSettings> =
	z.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
		voice: z.string().min(1).optional(),
	});

export const ProviderModeSettingsSchemas = {
	voiceInput: VoiceInputModeSettingsSchema,
	voiceOutput: VoiceOutputModeSettingsSchema,
	realtimeVoice: RealtimeVoiceModeSettingsSchema,
} as const satisfies {
	[Mode in ProviderMode]: z.ZodType<ProviderModeSettingsMap[Mode]>;
};

export function parseProviderModeSettings<Mode extends ProviderMode>(
	mode: Mode,
	settings: unknown,
): ProviderModeSettingsMap[Mode] {
	return ProviderModeSettingsSchemas[mode].parse(
		settings,
	) as ProviderModeSettingsMap[Mode];
}

export type StoredProviderModes = ProviderModesSettings;

export interface StoredProviderSettingsEntry {
	settings: ProviderSettings;
	updatedAt: string;
	tokenSource: ProviderTokenSource;
}

export interface StoredProviderSettings {
	version: 1;
	lastUsedProvider?: string;
	modes: StoredProviderModes;
	providers: Record<string, StoredProviderSettingsEntry>;
}

const StoredProviderModesSchemaShape = Object.fromEntries(
	PROVIDER_MODE_IDS.map((mode) => [
		mode,
		ProviderModeSettingsSchemas[mode].optional(),
	]),
) as {
	[Mode in ProviderMode]: z.ZodOptional<
		(typeof ProviderModeSettingsSchemas)[Mode]
	>;
};

export const StoredProviderModesSchema: z.ZodType<StoredProviderModes> =
	z.object(StoredProviderModesSchemaShape);

export const StoredProviderSettingsEntrySchema: z.ZodType<StoredProviderSettingsEntry> =
	z.object({
		settings: ProviderSettingsSchema,
		updatedAt: z.string().datetime(),
		tokenSource: z.enum(["manual", "oauth", "migration"]).default("manual"),
	});

export const StoredProviderSettingsSchema: z.ZodType<StoredProviderSettings> =
	z.object({
		version: z.literal(1),
		lastUsedProvider: z.string().min(1).optional(),
		modes: StoredProviderModesSchema.default({}),
		providers: z.record(z.string(), StoredProviderSettingsEntrySchema),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 1,
		modes: {},
		providers: {},
	};
}
