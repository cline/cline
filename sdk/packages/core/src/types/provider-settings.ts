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

export type ProviderTokenSource = "manual" | "migration";

export interface StoredProviderSettingsEntry {
	settings: ProviderSettings;
	updatedAt: string;
	tokenSource: ProviderTokenSource;
}

export interface StoredProviderSettings {
	version: 2;
	lastUsedProvider: "bedrock";
	providers: Record<string, StoredProviderSettingsEntry>;
}

export const StoredProviderSettingsEntrySchema: z.ZodType<StoredProviderSettingsEntry> =
	z.object({
		settings: ProviderSettingsSchema,
		updatedAt: z.string().datetime(),
		tokenSource: z.enum(["manual", "migration"]).default("manual"),
	});

export const StoredProviderSettingsSchema: z.ZodType<StoredProviderSettings> =
	z.object({
		version: z.literal(2),
		lastUsedProvider: z.literal("bedrock").default("bedrock"),
		providers: z.record(z.string(), StoredProviderSettingsEntrySchema),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 2,
		lastUsedProvider: "bedrock",
		providers: {},
	};
}
