import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type RemoteHelperTarget,
	remoteHelperBinaryFilename,
} from "@cline/core";

export function resolveDesktopRemoteHelper(
	target: RemoteHelperTarget,
	options: { execPath?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string | undefined {
	const env = options.env ?? process.env;
	if (env.CLINE_REMOTE_HELPER_BINARY) return env.CLINE_REMOTE_HELPER_BINARY;
	const filename = remoteHelperBinaryFilename(target);
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	const cwd = options.cwd ?? process.cwd();
	return [
		...(env.CLINE_REMOTE_HELPER_DIRECTORY
			? [join(env.CLINE_REMOTE_HELPER_DIRECTORY, filename)]
			: []),
		join(executableDirectory, "remote-helpers", filename),
		join(executableDirectory, "bin", "remote-helpers", filename),
		join(
			executableDirectory,
			"..",
			"Resources",
			"bin",
			"remote-helpers",
			filename,
		),
		join(cwd, "src-tauri", "bin", "remote-helpers", filename),
		join(
			cwd,
			"apps",
			"examples",
			"desktop-app",
			"src-tauri",
			"bin",
			"remote-helpers",
			filename,
		),
	].find(existsSync);
}
