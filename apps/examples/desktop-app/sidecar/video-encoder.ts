import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { FACTORY_BROWSERS_PATH_ENV } from "@cline/core";
import { linuxResourceCandidates } from "./remote-helper";

// scripts/stage-video-encoder.ts stages Playwright's video encoder here and
// tauri.conf.json bundles the directory as a resource.
const BUNDLED_BROWSERS = join("bin", "playwright");

/**
 * Points the Factory tester's recording at the video encoder bundled with
 * the app. Runs before this binary becomes the Hub daemon, and the daemon it
 * spawns inherits the variable, so the capture in the Hub finds the encoder.
 */
export function configureBundledVideoEncoder(
	options: {
		env?: NodeJS.ProcessEnv;
		execPath?: string;
		sourceDirectory?: string;
	} = {},
): string | undefined {
	const env = options.env ?? process.env;
	if (env[FACTORY_BROWSERS_PATH_ENV]) return env[FACTORY_BROWSERS_PATH_ENV];
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	const directory = [
		join(executableDirectory, "..", "Resources", BUNDLED_BROWSERS),
		join(executableDirectory, BUNDLED_BROWSERS),
		...linuxResourceCandidates(executableDirectory, BUNDLED_BROWSERS),
		// `bun run dev` runs this file from source; build:sidecar:bin stages it.
		join(
			options.sourceDirectory ?? import.meta.dirname,
			"..",
			"src-tauri",
			BUNDLED_BROWSERS,
		),
	].find(existsSync);
	if (directory) env[FACTORY_BROWSERS_PATH_ENV] = directory;
	return directory;
}
