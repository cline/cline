import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import { cachedByFile } from "./store/data-dir";

type LifecycleOptions = {
	settingsPath?: string;
	entryPaths?: readonly string[];
	packageRoot?: string;
};

/**
 * `disabledPlugins` from Cline's global settings, as resolved paths. A
 * missing file reads as none disabled; one that cannot be read or parsed
 * keeps what was last read.
 */
function readDisabledPlugins(
	settingsPath: string,
	previous: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
	let parsed: { disabledPlugins?: unknown } | null;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? new Set()
			: previous;
	}
	return new Set(
		Array.isArray(parsed?.disabledPlugins)
			? parsed.disabledPlugins
					.filter((item): item is string => typeof item === "string")
					.map((item) => resolve(item))
			: [],
	);
}

/**
 * Checks whether Next Turn is still enabled and installed, so an open chat's
 * sandbox goes quiet immediately when the person disables or uninstalls the
 * plugin without waiting for the session to close.
 */
export class PluginLifecycle {
	private readonly packageRoot: string;
	private readonly entryPaths: readonly string[];
	private readonly disabled: () => ReadonlySet<string>;

	constructor(options: LifecycleOptions = {}) {
		const settingsPath = options.settingsPath ?? resolveGlobalSettingsPath();
		this.disabled = cachedByFile(settingsPath, (previous) =>
			readDisabledPlugins(settingsPath, previous),
		);
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		this.packageRoot = options.packageRoot ?? resolve(moduleDir, "..");
		this.entryPaths = (
			options.entryPaths ?? [
				join(this.packageRoot, "dist", "index.js"),
				join(this.packageRoot, "src", "index.ts"),
			]
		).map((path) => resolve(path));
	}

	active(): boolean {
		if (!existsSync(join(this.packageRoot, "package.json"))) return false;
		const disabled = this.disabled();
		return !this.entryPaths.some((entry) => disabled.has(entry));
	}
}
