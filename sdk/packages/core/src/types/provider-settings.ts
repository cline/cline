import type {
	MediaGenerationSettings,
	MediaModelSelection,
} from "@cline/shared";
import { MEDIA_GENERATION_TYPES } from "@cline/shared";
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
	MediaGenerationSettings,
	MediaModelSelection,
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

export const VoiceInputSettingsSchema = z.object({
	providerId: z.string().min(1),
	modelId: z.string().min(1),
});

export type VoiceInputSettings = z.infer<typeof VoiceInputSettingsSchema>;

export const MediaModelSelectionSchema: z.ZodType<MediaModelSelection> =
	z.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	});

export const MediaGenerationSettingsSchema: z.ZodType<MediaGenerationSettings> =
	z.partialRecord(z.enum(MEDIA_GENERATION_TYPES), MediaModelSelectionSchema);

export interface StoredProviderModes {
	voiceInput?: VoiceInputSettings;
	mediaGeneration?: MediaGenerationSettings;
}

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

export const StoredProviderModesSchema: z.ZodType<StoredProviderModes> =
	z.object({
		voiceInput: VoiceInputSettingsSchema.optional(),
		mediaGeneration: MediaGenerationSettingsSchema.optional(),
	});

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
