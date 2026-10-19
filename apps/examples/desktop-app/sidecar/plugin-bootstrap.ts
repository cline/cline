import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLINE_PLUGIN_BOOTSTRAP_PATH_ENV } from "@cline/core";
import { linuxResourceCandidates } from "./remote-helper";

const BUNDLED_BOOTSTRAP = join("bin", "extensions", "plugin-sandbox-bootstrap.js");

/**
 * Finds the plugin worker bootstrap the app bundle ships as a Tauri resource.
 * The backend and CLI-managed Hub need an on-disk bootstrap to run plugins
 * in workers; without it they would fall back to loading plugins in-process.
 */
export function resolveDesktopPluginBootstrap(
	options: { execPath?: string; cwd?: string } = {},
): string | undefined {
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	const cwd = options.cwd ?? process.cwd();
	return [
		join(executableDirectory, BUNDLED_BOOTSTRAP),
		join(executableDirectory, "..", "Resources", BUNDLED_BOOTSTRAP),
		...linuxResourceCandidates(executableDirectory, BUNDLED_BOOTSTRAP),
		join(cwd, "src-tauri", BUNDLED_BOOTSTRAP),
	].find(existsSync);
}

/** Exposes the bundled bootstrap to core and to the Hub daemon this spawns. */
export function configurePluginBootstrap(env = process.env): void {
	if (env[CLINE_PLUGIN_BOOTSTRAP_PATH_ENV]) return;
	const bootstrap = resolveDesktopPluginBootstrap();
	if (bootstrap) env[CLINE_PLUGIN_BOOTSTRAP_PATH_ENV] = bootstrap;
}
