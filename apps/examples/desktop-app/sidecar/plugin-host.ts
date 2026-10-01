import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { linuxResourceCandidates } from "./remote-helper";

const PLUGIN_HOST_DIRECTORY_NAME = "plugin-host";

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Locate the bundled plugin host: the on-disk `node_modules` tree with the SDK
 * packages, jiti, and the plugin sandbox bootstrap that plugins need at
 * runtime (scripts/build-plugin-host.ts). The compiled sidecar has none of
 * these on real disk, so without it plugin loading cannot even start.
 */
export function resolveDesktopPluginHostDir(
	options: { execPath?: string; env?: NodeJS.ProcessEnv } = {},
): string | undefined {
	const env = options.env ?? process.env;
	if (env.CLINE_PLUGIN_HOST_DIR) return env.CLINE_PLUGIN_HOST_DIR;
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	return [
		// Windows installs resources next to the executable; the repo layout
		// keeps the compiled sidecar in src-tauri/bin beside src-tauri/plugin-host.
		join(executableDirectory, PLUGIN_HOST_DIRECTORY_NAME),
		join(executableDirectory, "..", PLUGIN_HOST_DIRECTORY_NAME),
		join(executableDirectory, "..", "Resources", PLUGIN_HOST_DIRECTORY_NAME),
		...linuxResourceCandidates(executableDirectory, PLUGIN_HOST_DIRECTORY_NAME),
	].find(isDirectory);
}
