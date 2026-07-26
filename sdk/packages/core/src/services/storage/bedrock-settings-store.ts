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
import { resolveProviderSettingsPath } from "@bedrock-coder/shared/storage";
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
				chmodSync(this.filePath, 0o600);
			} catch {
				// Invalid content is ignored; read() returns a clean Bedrock state.
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
