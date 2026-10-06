import { resolveHubBuildIdentity } from "@cline/core/hub";
import { version } from "../../package.json";
import { resolveCliLaunchSpec } from "./internal-launch";

/** Probe an installed CLI without starting a Hub, telemetry, or an update. */
export function getCliRuntimeInfo() {
	return {
		cliVersion: version,
		...resolveHubBuildIdentity(),
		executablePath: process.execPath,
		compiled: resolveCliLaunchSpec()?.mode === "compiled",
		platform: process.platform,
		arch: process.arch,
	};
}
