import * as os from "node:os";
import { CORE_BUILD_VERSION } from "@cline/core";
import { version as appVersion } from "../package.json";
import type { DesktopRuntimeInfo } from "../shared/desktop-runtime-info";
import type { DesktopEnvironmentInitialization } from "./environment";

interface DesktopRuntimeInfoSources {
	appVersion: string;
	coreVersion: string;
	bunVersion: string;
	nodeVersion: string;
	os: DesktopRuntimeInfo["os"];
}

function defaultSources(): DesktopRuntimeInfoSources {
	const version = os.version();
	return {
		appVersion,
		coreVersion: CORE_BUILD_VERSION,
		bunVersion: process.versions.bun ?? "unknown",
		nodeVersion: process.version,
		os: {
			platform: os.platform(),
			name: os.type(),
			version: version && version !== "unknown" ? version : os.release(),
			release: os.release(),
			arch: os.arch(),
		},
	};
}

/** Build the canonical host/runtime snapshot exposed to desktop clients. */
export function createDesktopRuntimeInfo(
	environment: DesktopEnvironmentInitialization,
	sources: DesktopRuntimeInfoSources = defaultSources(),
): DesktopRuntimeInfo {
	return {
		app: { name: "Cline Code", version: sources.appVersion },
		sdk: { coreVersion: sources.coreVersion },
		runtime: {
			name: "bun",
			version: sources.bunVersion,
			nodeVersion: sources.nodeVersion,
		},
		os: { ...sources.os },
		environment: {
			pathSource: environment.pathSource,
			pathChanged: environment.pathChanged,
		},
	};
}
