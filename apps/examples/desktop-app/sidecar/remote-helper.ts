import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type RemoteHelperTarget,
	remoteHelperBinaryFilename,
} from "@cline/core";

// Tauri's Linux bundles (deb, rpm, AppImage) install binaries under `usr/bin`
// and resources under `usr/lib/<productName>`. The product name differs per
// release channel ("Cline", "Cline Beta"), so scan the sibling lib directory.
function linuxResourceCandidates(
	executableDirectory: string,
	relativePath: string,
): string[] {
	const libDirectory = join(executableDirectory, "..", "lib");
	try {
		return readdirSync(libDirectory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(libDirectory, entry.name, relativePath));
	} catch {
		return [];
	}
}

export function resolveDesktopRemoteHelper(
	target: RemoteHelperTarget,
	options: { execPath?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string | undefined {
	const env = options.env ?? process.env;
	if (env.CLINE_REMOTE_HELPER_BINARY) return env.CLINE_REMOTE_HELPER_BINARY;
	const filename = remoteHelperBinaryFilename(target);
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	const cwd = options.cwd ?? process.cwd();
	const bundledPath = join("bin", "remote-helpers", filename);
	return [
		...(env.CLINE_REMOTE_HELPER_DIRECTORY
			? [join(env.CLINE_REMOTE_HELPER_DIRECTORY, filename)]
			: []),
		join(executableDirectory, "remote-helpers", filename),
		join(executableDirectory, bundledPath),
		join(executableDirectory, "..", "Resources", bundledPath),
		...linuxResourceCandidates(executableDirectory, bundledPath),
		join(cwd, "src-tauri", bundledPath),
		join(cwd, "apps", "examples", "desktop-app", "src-tauri", bundledPath),
	].find(existsSync);
}
