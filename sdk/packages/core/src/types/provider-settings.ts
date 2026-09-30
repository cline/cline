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

export const VoiceInputSettingsSchema = z.object({
	providerId: z.string().min(1),
	modelId: z.string().min(1),
});

export type VoiceInputSettings = z.infer<typeof VoiceInputSettingsSchema>;

export interface StoredProviderModes {
	voiceInput?: VoiceInputSettings;
}

export interface StoredProviderSettingsEntry {
	settings: ProviderSettings;
	updatedAt: string;
	tokenSource: ProviderTokenSource;
}

/**
 * One-shot repairs the legacy migration has already applied to this file.
 * A repair reads legacy state that stays on disk forever, so without a marker
 * it would re-apply on every launch and fight a user who undoes it.
 */
export interface StoredProviderRepairs {
	/** Restored a bare legacy `awsProfile` onto an already-migrated entry. */
	bedrockProfile?: boolean;
}

export interface StoredProviderSettings {
	version: 1;
	lastUsedProvider?: string;
	modes: StoredProviderModes;
	repairs?: StoredProviderRepairs;
	providers: Record<string, StoredProviderSettingsEntry>;
}

export const StoredProviderModesSchema: z.ZodType<StoredProviderModes> =
	z.object({
		voiceInput: VoiceInputSettingsSchema.optional(),
	});

export const StoredProviderRepairsSchema: z.ZodType<StoredProviderRepairs> =
	z.object({
		bedrockProfile: z.boolean().optional(),
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
		repairs: StoredProviderRepairsSchema.optional(),
		providers: z.record(z.string(), StoredProviderSettingsEntrySchema),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 1,
		modes: {},
		providers: {},
	};
}
