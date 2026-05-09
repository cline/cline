import * as os from "node:os";
import type { RuntimeEnv } from "@clinebot/shared";
import { displayName, version } from "../../package.json";

export function getCliBuildInfo(): RuntimeEnv {
	return {
		name: displayName,
		version,
		platform: "terminal",
		platform_version: process.version,
		os_type: os.platform(),
		os_version: os.version(),
	};
}
