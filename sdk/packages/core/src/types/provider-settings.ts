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

export interface StoredProviderSettings {
	version: 1;
	lastUsedProvider?: string;
	modes: StoredProviderModes;
	providers: Record<string, StoredProviderSettingsEntry>;
	/**
	 * Providers the user explicitly disconnected. The legacy VS Code import
	 * re-runs on every startup and merges any provider it finds missing, so
	 * without this it would resurrect credentials the user just removed.
	 */
	removedProviders?: string[];
}

export const StoredProviderModesSchema: z.ZodType<StoredProviderModes> =
	z.object({
		voiceInput: VoiceInputSettingsSchema.optional(),
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
		removedProviders: z.array(z.string().min(1)).optional(),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 1,
		modes: {},
		providers: {},
	};
}
