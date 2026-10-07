import { closeSync, openSync, readSync } from "node:fs";
import { resolveHubBuildIdentity } from "@cline/core/hub";
import { version } from "../../package.json";
import { resolveCliLaunchSpec } from "./internal-launch";

declare const CLINE_CLI_COMPILE_TARGET: string | undefined;
export function getCliRuntimeTarget(): string {
	if (process.platform === "darwin") {
		const fd = openSync(process.execPath, "r");
		try {
			const header = Buffer.alloc(4);
			readSync(fd, header, 0, 4, 0);
			if (header.readUInt32BE(0) === 0xcafebabe)
				return "universal-apple-darwin";
		} finally {
			closeSync(fd);
		}
		return `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
	}
	return process.platform === "win32"
		? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`
		: `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`;
}

/** Probe an installed CLI without starting a Hub, telemetry, or an update. */
export function getCliRuntimeInfo() {
	const compileTarget =
		typeof CLINE_CLI_COMPILE_TARGET === "undefined"
			? undefined
			: CLINE_CLI_COMPILE_TARGET;
	return {
		cliVersion: version,
		...resolveHubBuildIdentity(),
		executablePath: process.execPath,
		compiled: resolveCliLaunchSpec()?.mode === "compiled",
		platform: process.platform,
		arch: process.arch,
		target: getCliRuntimeTarget(),
		cpuBaseline: compileTarget?.includes("baseline") ?? false,
		launchEnv: {
			...(process.env.NODE_EXTRA_CA_CERTS
				? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
				: {}),
			...(process.env.CLINE_WRAPPER_PATH
				? { CLINE_WRAPPER_PATH: process.env.CLINE_WRAPPER_PATH }
				: {}),
		},
	};
}
