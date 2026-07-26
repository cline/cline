import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { BEDROCK_DEFAULT_MODEL_ID } from "@cline/llms";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import {
	emptyStoredProviderSettings,
	type ProviderConfig,
	type ProviderSettings,
	ProviderSettingsSchemaTyped as ProviderSettingsSchema,
	type ProviderTokenSource,
	type StoredProviderSettings,
	StoredProviderSettingsSchema,
	type ToProviderConfigOptions,
	toProviderConfig,
} from "../../types/provider-settings";

function nowIso(): string {
	return new Date().toISOString();
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function optionalString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function migrateLegacyState(input: unknown): StoredProviderSettings {
	const root = record(input);
	const providers = record(root.providers);
	const bedrockEntry = record(providers.bedrock);
	const legacy = record(bedrockEntry.settings ?? bedrockEntry);
	const connection = record(legacy.connection);
	const aws = record(legacy.aws);
	const region =
		optionalString(connection.region, legacy.region, aws.region) ?? "us-east-1";
	const settings: ProviderSettings = ProviderSettingsSchema.parse({
		provider: "bedrock",
		model:
			optionalString(legacy.model, legacy.modelId) ??
			BEDROCK_DEFAULT_MODEL_ID,
		connection: {
			region,
			profile: optionalString(connection.profile, aws.profile),
			endpoint: optionalString(connection.endpoint, aws.endpoint),
			caBundlePath: optionalString(
				connection.caBundlePath,
				aws.caBundlePath,
				legacy.caBundlePath,
			),
		},
		reasoning: legacy.reasoning,
		maxTokens: legacy.maxTokens,
		contextWindow: legacy.contextWindow,
	});
	return {
		version: 2,
		lastUsedProvider: "bedrock",
		providers: {
			bedrock: {
				settings,
				updatedAt: nowIso(),
				tokenSource: "migration",
			},
		},
	};
}

export interface BedrockSettingsStoreOptions {
	filePath?: string;
	dataDir?: string;
}

export interface SaveBedrockSettingsOptions {
	tokenSource?: ProviderTokenSource;
}

export class BedrockSettingsStore {
	private readonly filePath: string;

	constructor(options: BedrockSettingsStoreOptions = {}) {
		this.filePath = options.filePath ?? resolveProviderSettingsPath();
		if (existsSync(this.filePath)) {
			try {
				const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
				if (!StoredProviderSettingsSchema.safeParse(parsed).success) {
					this.write(migrateLegacyState(parsed));
				}
				chmodSync(this.filePath, 0o600);
			} catch {
				// Invalid legacy content is ignored; a clean Bedrock state is used.
			}
		}
	}

	getFilePath(): string {
		return this.filePath;
	}

	read(): StoredProviderSettings {
		if (!existsSync(this.filePath)) return emptyStoredProviderSettings();
		try {
			const result = StoredProviderSettingsSchema.safeParse(
				JSON.parse(readFileSync(this.filePath, "utf8")),
			);
			return result.success ? result.data : emptyStoredProviderSettings();
		} catch {
			return emptyStoredProviderSettings();
		}
	}

	write(state: StoredProviderSettings): void {
		const normalized = StoredProviderSettingsSchema.parse({
			...state,
			version: 2,
			lastUsedProvider: "bedrock",
			providers: state.providers.bedrock
				? { bedrock: state.providers.bedrock }
				: {},
		});
		const directory = dirname(this.filePath);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
		const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
		try {
			writeFileSync(
				temporaryPath,
				`${JSON.stringify(normalized, null, 2)}\n`,
				{ encoding: "utf8", mode: 0o600 },
			);
			renameSync(temporaryPath, this.filePath);
			try {
				chmodSync(this.filePath, 0o600);
			} catch {}
		} catch (error) {
			rmSync(temporaryPath, { force: true });
			throw error;
		}
	}

	save(
		settings: unknown,
		options: SaveBedrockSettingsOptions = {},
	): StoredProviderSettings {
		const validated = ProviderSettingsSchema.parse(settings);
		const previous = this.read();
		const next: StoredProviderSettings = {
			version: 2,
			lastUsedProvider: "bedrock",
			providers: {
				bedrock: {
					settings: validated,
					updatedAt: nowIso(),
					tokenSource:
						options.tokenSource ??
						previous.providers.bedrock?.tokenSource ??
						"manual",
				},
			},
		};
		this.write(next);
		return next;
	}

	getSettings(): ProviderSettings | undefined {
		return this.read().providers.bedrock?.settings;
	}

	getConfig(
		options?: ToProviderConfigOptions,
	): ProviderConfig | undefined {
		const settings = this.getSettings();
		return settings ? toProviderConfig(settings, options) : undefined;
	}
}
