import { version } from "../../package.json";

const CLINE_HUB_BUILD_ID_ENV = "CLINE_HUB_BUILD_ID";

export function configureCliHubCompatibility(
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (env[CLINE_HUB_BUILD_ID_ENV]?.trim()) {
		return;
	}

	// The SDK defaults hub compatibility to @cline/core's version, but published
	// CLI releases can change CLI-owned hub behavior while @cline/core stays on
	// the same workspace package version. Stamp local hubs with the CLI release
	// before any SDK hub code probes or spawns the daemon.
	env[CLINE_HUB_BUILD_ID_ENV] = `cli:${version}`;
}
