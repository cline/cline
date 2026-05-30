import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import lockfile from "proper-lockfile";
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

const SETTINGS_WRITE_LOCK_STALE_MS = 10_000;
const SETTINGS_WRITE_LOCK_TIMEOUT_MS = 12_000;
const SETTINGS_WRITE_LOCK_RETRY_MS = 10;
const syncWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

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

export interface WriteProviderSettingsOptions {
	allowOpenAICodexAuthReplacement?: boolean;
}

export interface ProviderSettingsRefreshLockOptions {
	staleMs?: number;
	updateMs?: number;
	retries?: number;
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

function isLockHeldError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ELOCKED";
}

function withSettingsWriteLock<T>(filePath: string, callback: () => T): T {
	const lockTarget = `${filePath}.write`;
	const dir = dirname(lockTarget);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	const startedAt = Date.now();
	let release: (() => void) | undefined;
	while (!release) {
		try {
			release = lockfile.lockSync(lockTarget, {
				stale: SETTINGS_WRITE_LOCK_STALE_MS,
				realpath: false,
			});
		} catch (error) {
			if (
				!isLockHeldError(error) ||
				Date.now() - startedAt >= SETTINGS_WRITE_LOCK_TIMEOUT_MS
			) {
				throw error;
			}
			Atomics.wait(syncWaitBuffer, 0, 0, SETTINGS_WRITE_LOCK_RETRY_MS);
		}
	}
	try {
		return callback();
	} finally {
		release();
	}
}

function preserveDurableOpenAICodexEntry(
	state: StoredProviderSettings,
	durableState: StoredProviderSettings,
	options: WriteProviderSettingsOptions,
): StoredProviderSettings {
	const durableEntry = durableState.providers["openai-codex"];
	if (
		options.allowOpenAICodexAuthReplacement ||
		durableEntry?.tokenSource !== "oauth" ||
		!durableEntry.settings.auth
	) {
		return state;
	}
	const nextEntry = state.providers["openai-codex"];
	if (!nextEntry) {
		return {
			...state,
			providers: {
				...state.providers,
				"openai-codex": durableEntry,
			},
		};
	}
	return {
		...state,
		providers: {
			...state.providers,
			"openai-codex": {
				...nextEntry,
				settings: {
					...nextEntry.settings,
					auth: durableEntry.settings.auth,
				},
				tokenSource: durableEntry.tokenSource,
			},
		},
	};
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

	write(
		state: StoredProviderSettings,
		options: WriteProviderSettingsOptions = {},
	): StoredProviderSettings {
		const parsed = StoredProviderSettingsSchema.parse(state);
		return withSettingsWriteLock(this.filePath, () => {
			const normalized = preserveDurableOpenAICodexEntry(
				parsed,
				this.read(),
				options,
			);
			const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
			try {
				writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, {
					encoding: "utf8",
					mode: 0o600,
				});
				// Restrict file to owner-only read/write (best-effort; no-op on Windows).
				try {
					chmodSync(tempPath, 0o600);
				} catch {
					// Ignore — Windows does not support POSIX chmod.
				}
				renameSync(tempPath, this.filePath);
			} finally {
				rmSync(tempPath, { force: true });
			}
			registerConfiguredProvidersFromSettings(normalized);
			return normalized;
		});
	}

	async withProviderRefreshLock<T>(
		providerId: string,
		callback: () => Promise<T>,
		options: ProviderSettingsRefreshLockOptions = {},
	): Promise<T> {
		const lockTarget = `${this.filePath}.${providerId.replace(/[^a-zA-Z0-9_.-]+/g, "_")}.refresh`;
		const dir = dirname(lockTarget);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		const release = await lockfile.lock(lockTarget, {
			stale: options.staleMs ?? 60_000,
			update: options.updateMs ?? 10_000,
			realpath: false,
			retries: {
				retries: options.retries ?? 60,
				factor: 1.2,
				minTimeout: 100,
				maxTimeout: 1_000,
				randomize: true,
			},
		});
		try {
			return await callback();
		} finally {
			await release();
		}
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
		return this.write(next, {
			allowOpenAICodexAuthReplacement: options.tokenSource === "oauth",
		});
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
