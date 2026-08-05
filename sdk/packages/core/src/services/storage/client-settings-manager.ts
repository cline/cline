import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type {
	ProviderMode,
	ProviderModeSettingsMap,
	ProviderModesSettings,
} from "@cline/shared";
import { resolveClientSettingsPath } from "@cline/shared/storage";
import { z } from "zod";
import {
	parseProviderModeSettings,
	StoredProviderModesSchema,
} from "../../types/provider-settings";

export interface StoredClientSettings {
	version: 1;
	modes: ProviderModesSettings;
}

const StoredClientSettingsSchema: z.ZodType<StoredClientSettings> = z.object({
	version: z.literal(1),
	modes: StoredProviderModesSchema.default({}),
});

export interface ClientSettingsManagerOptions {
	clientId?: string;
	filePath?: string;
}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 2_000;
const STALE_LOCK_MS = 30_000;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function emptyClientSettings(): StoredClientSettings {
	return { version: 1, modes: {} };
}

export class ClientSettingsManager {
	private readonly filePath: string;

	constructor(options: ClientSettingsManagerOptions = {}) {
		this.filePath =
			options.filePath ??
			resolveClientSettingsPath(options.clientId ?? "desktop");
	}

	getFilePath(): string {
		return this.filePath;
	}

	read(): StoredClientSettings {
		if (!existsSync(this.filePath)) return emptyClientSettings();
		try {
			return StoredClientSettingsSchema.parse(
				JSON.parse(readFileSync(this.filePath, "utf8")),
			);
		} catch {
			return emptyClientSettings();
		}
	}

	private acquireLock(): () => void {
		const lockPath = `${this.filePath}.lock`;
		mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
		const deadline = Date.now() + LOCK_TIMEOUT_MS;
		while (true) {
			try {
				mkdirSync(lockPath);
				return () => rmSync(lockPath, { recursive: true, force: true });
			} catch (error) {
				try {
					if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
						rmSync(lockPath, { recursive: true, force: true });
						continue;
					}
				} catch {
					continue;
				}
				if (Date.now() >= deadline) {
					throw new Error(
						`Timed out locking client settings at ${this.filePath}`,
						{
							cause: error,
						},
					);
				}
				Atomics.wait(sleepArray, 0, 0, LOCK_RETRY_MS);
			}
		}
	}

	private update(
		updater: (current: StoredClientSettings) => StoredClientSettings,
	): StoredClientSettings {
		const release = this.acquireLock();
		try {
			const next = StoredClientSettingsSchema.parse(updater(this.read()));
			const tempPath = `${this.filePath}.${process.pid}.tmp`;
			try {
				writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
					encoding: "utf8",
					mode: 0o600,
				});
				renameSync(tempPath, this.filePath);
			} catch (error) {
				rmSync(tempPath, { force: true });
				throw error;
			}
			try {
				chmodSync(this.filePath, 0o600);
			} catch {
				// Windows does not support POSIX permissions.
			}
			return next;
		} finally {
			release();
		}
	}

	getModeSettings<Mode extends ProviderMode>(
		mode: Mode,
	): ProviderModeSettingsMap[Mode] | undefined {
		return this.read().modes[mode];
	}

	setModeSettings<Mode extends ProviderMode>(
		mode: Mode,
		settings: ProviderModeSettingsMap[Mode] | undefined,
	): StoredClientSettings {
		return this.update((current) => {
			const modes = { ...current.modes };
			if (settings) modes[mode] = parseProviderModeSettings(mode, settings);
			else delete modes[mode];
			return { ...current, modes };
		});
	}

	initializeModesIfMissing(modes: ProviderModesSettings): StoredClientSettings {
		if (existsSync(this.filePath)) return this.read();
		return this.update((current) => ({
			...current,
			modes: StoredProviderModesSchema.parse(modes),
		}));
	}
}
