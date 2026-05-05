import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { resolveProviderSettingsPath } from "@clinebot/shared/storage";
import { getLiveModelsCatalog } from "../..";
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
import {
	ensureCustomProvidersLoadedSync,
	registerConfiguredProvidersFromSettings,
} from "../providers/local-provider-registry";
import { migrateLegacyProviderSettings } from "./provider-settings-legacy-migration";

function nowIso(): string {
	return new Date().toISOString();
}

export interface ProviderSettingsManagerOptions {
	filePath?: string;
	dataDir?: string;
}

export interface SaveProviderSettingsOptions {
	setLastUsed?: boolean;
	tokenSource?: ProviderTokenSource;
}

function inferLegacyDataDir(filePath: string): string | undefined {
	if (basename(filePath) !== "providers.json") {
		return undefined;
	}
	const settingsDir = dirname(filePath);
	if (basename(settingsDir) !== "settings") {
		return undefined;
	}
	return dirname(settingsDir);
}

export class ProviderSettingsManager {
	private readonly filePath: string;
	private readonly dataDir?: string;

	constructor(options: ProviderSettingsManagerOptions = {}) {
		this.filePath = options.filePath ?? resolveProviderSettingsPath();
		this.dataDir = options.dataDir ?? inferLegacyDataDir(this.filePath);
		if (this.dataDir || !options.filePath) {
			migrateLegacyProviderSettings({
				providerSettingsManager: this,
				dataDir: this.dataDir,
			});
		}
		ensureCustomProvidersLoadedSync(this);
		registerConfiguredProvidersFromSettings(this.read());
		// Harden permissions on any existing file at startup so that
		// pre-existing installations are also protected (best-effort; no-op on Windows).
		if (existsSync(this.filePath)) {
			try {
				chmodSync(this.filePath, 0o600);
			} catch {
				// Ignore — Windows does not support POSIX chmod.
			}
		}
	}

	getFilePath(): string {
		return this.filePath;
	}

	read(): StoredProviderSettings {
		if (!existsSync(this.filePath)) {
			return emptyStoredProviderSettings();
		}

		try {
			const raw = readFileSync(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const result = StoredProviderSettingsSchema.safeParse(parsed);
			if (result.success) {
				registerConfiguredProvidersFromSettings(result.data);
				return result.data;
			}
		} catch {
			// Invalid content falls back to a clean state.
		}

		return emptyStoredProviderSettings();
	}

	write(state: StoredProviderSettings): void {
		const normalized = StoredProviderSettingsSchema.parse(state);
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		writeFileSync(
			this.filePath,
			`${JSON.stringify(normalized, null, 2)}\n`,
			"utf8",
		);
		// Restrict file to owner-only read/write (best-effort; no-op on Windows).
		try {
			chmodSync(this.filePath, 0o600);
		} catch {
			// Ignore — Windows does not support POSIX chmod.
		}
		registerConfiguredProvidersFromSettings(normalized);
	}

	saveProviderSettings(
		settings: unknown,
		options: SaveProviderSettingsOptions = {},
	): StoredProviderSettings {
		const validatedSettings = ProviderSettingsSchema.parse(settings);
		const previous = this.read();
		const providerId = validatedSettings.provider;
		const shouldSetLastUsed = options.setLastUsed !== false;
		const previousEntry = previous.providers[providerId];
		const tokenSource =
			options.tokenSource ?? previousEntry?.tokenSource ?? "manual";
		const next: StoredProviderSettings = {
			...previous,
			providers: {
				...previous.providers,
				[providerId]: {
					settings: validatedSettings,
					updatedAt: nowIso(),
					tokenSource,
				},
			},
			lastUsedProvider: shouldSetLastUsed
				? providerId
				: previous.lastUsedProvider,
		};
		this.write(next);
		return next;
	}

	getProviderSettings(providerId: string): ProviderSettings | undefined {
		const state = this.read();
		return state.providers[providerId]?.settings;
	}

	getLastUsedProviderSettings(): ProviderSettings | undefined {
		const state = this.read();
		const providerId = state.lastUsedProvider;
		if (!providerId) {
			return undefined;
		}
		return state.providers[providerId]?.settings;
	}

	getProviderConfig(
		providerId: string,
		options?: ToProviderConfigOptions,
	): ProviderConfig | undefined {
		const settings = this.getProviderSettings(providerId);
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings, options);
	}

	getLastUsedProviderConfig(
		options?: ToProviderConfigOptions,
	): ProviderConfig | undefined {
		const settings = this.getLastUsedProviderSettings();
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings, options);
	}

	async refreshCatalog(): Promise<void> {
		try {
			await getLiveModelsCatalog({});
		} catch {
			// Ignore errors
		}
	}
}
