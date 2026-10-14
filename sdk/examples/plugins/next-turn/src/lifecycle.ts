import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_SETTINGS_FILE, GLOBAL_SETTINGS_SUBDIR } from "./config";
import { resolveClineDataDir } from "./store/data-dir";

/**
 * Checks whether Next Turn is still enabled and installed, so an open chat's
 * sandbox goes quiet immediately when the person disables or uninstalls the
 * plugin without waiting for the session to close.
 */

export type LifecycleOptions = {
	env?: NodeJS.ProcessEnv;
	home?: string;
	entryPaths?: readonly string[];
	packageRoot?: string;
};

export function resolveGlobalSettingsPath(
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string {
	const explicit = env.CLINE_GLOBAL_SETTINGS_PATH?.trim();
	if (explicit) return explicit;
	return join(
		resolveClineDataDir(env, home),
		GLOBAL_SETTINGS_SUBDIR,
		GLOBAL_SETTINGS_FILE,
	);
}

export class PluginLifecycle {
	private readonly settingsPath: string;
	private readonly packageRoot: string;
	private readonly entryPaths: readonly string[];
	private cachedMtimeMs = -1;
	private cachedDisabled: ReadonlySet<string> = new Set();

	constructor(options: LifecycleOptions = {}) {
		this.settingsPath = resolveGlobalSettingsPath(options.env, options.home);
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		this.packageRoot = options.packageRoot ?? resolve(moduleDir, "..");
		this.entryPaths = (
			options.entryPaths ?? [
				resolve(this.packageRoot, "dist", "index.js"),
				resolve(this.packageRoot, "src", "index.ts"),
				resolve(this.packageRoot, "index.js"),
				resolve(this.packageRoot, "index.ts"),
			]
		).map((path) => resolve(path));
	}

	/** Force the next `active()` call to re-read `global-settings.json`. */
	invalidate(): void {
		this.cachedMtimeMs = -1;
	}

	active(): boolean {
		if (
			!existsSync(this.packageRoot) ||
			!existsSync(join(this.packageRoot, "package.json"))
		) {
			return false;
		}
		const disabled = this.disabledSet();
		for (const entry of this.entryPaths) {
			if (disabled.has(entry)) return false;
		}
		return true;
	}

	private disabledSet(): ReadonlySet<string> {
		if (!existsSync(this.settingsPath)) {
			this.cachedMtimeMs = -1;
			this.cachedDisabled = new Set();
			return this.cachedDisabled;
		}
		try {
			const mtimeMs = statSync(this.settingsPath).mtimeMs;
			if (mtimeMs === this.cachedMtimeMs) return this.cachedDisabled;
			const parsed = JSON.parse(readFileSync(this.settingsPath, "utf8")) as {
				disabledPlugins?: unknown;
			};
			const list = Array.isArray(parsed?.disabledPlugins)
				? parsed.disabledPlugins
						.filter((item): item is string => typeof item === "string")
						.map((item) => resolve(item))
				: [];
			this.cachedMtimeMs = mtimeMs;
			this.cachedDisabled = new Set(list);
			return this.cachedDisabled;
		} catch {
			return this.cachedDisabled;
		}
	}
}
