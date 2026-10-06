import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type RemoteHelperTarget,
	remoteHelperBinaryFilename,
} from "@cline/core";
import { resolveDesktopCliPath } from "./cli-runtime";

/** Base name of the Cline CLI binary the desktop app bundles (Tauri externalBin). */
export const DESKTOP_CLI_BINARY_NAME = "cline-cli";

const MACHO_FAT_MAGIC = 0xcafebabe;
const MACHO_64_MAGIC = 0xfeedfacf;
const MACHO_CPU_TYPE: Record<RemoteHelperTarget["arch"], number> = {
	arm64: 0x0100000c,
	x64: 0x01000007,
};

// Published desktop builds are universal, but `package:desktop:mac` and local
// `tauri build` produce a thin host-arch CLI that cannot run on a Mac of the
// other architecture. A fat binary starts with a big-endian magic; a thin
// 64-bit Mach-O starts with its little-endian magic followed by the cputype.
function machoRunsOn(path: string, arch: RemoteHelperTarget["arch"]): boolean {
	const header = Buffer.alloc(8);
	try {
		const fd = openSync(path, "r");
		try {
			readSync(fd, header, 0, 8, 0);
		} finally {
			closeSync(fd);
		}
	} catch {
		return false;
	}
	if (header.readUInt32BE(0) === MACHO_FAT_MAGIC) return true;
	return (
		header.readUInt32LE(0) === MACHO_64_MAGIC &&
		header.readUInt32LE(4) === MACHO_CPU_TYPE[arch]
	);
}

// macOS bundles carry no separate darwin copies of the CLI: Tauri signs only
// externalBin and the main binary, so a Mach-O under Contents/Resources would
// ship unsigned and fail notarization. The bundled CLI is the signed,
// notarized, universal Mach-O in the bundle, so it serves both x64 and arm64
// Mac remotes from a Mac. Under `tauri dev` the backend may run on a system
// Bun, so fall back to the CLI that beforeDevCommand compiles.
function macCliCandidates(
	target: RemoteHelperTarget,
	desktopCliPath: string | undefined,
	cwd: string,
): string[] {
	const compiledCli = `${DESKTOP_CLI_BINARY_NAME}-${target.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
	return [
		...(desktopCliPath && machoRunsOn(desktopCliPath, target.arch)
			? [desktopCliPath]
			: []),
		join(cwd, "src-tauri", "bin", compiledCli),
		join(
			cwd,
			"apps",
			"examples",
			"desktop-app",
			"src-tauri",
			"bin",
			compiledCli,
		),
	];
}

export function resolveDesktopRemoteHelper(
	target: RemoteHelperTarget,
	options: {
		execPath?: string;
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
	} = {},
): string | undefined {
	const env = options.env ?? process.env;
	if (env.CLINE_REMOTE_HELPER_BINARY) return env.CLINE_REMOTE_HELPER_BINARY;
	const filename = remoteHelperBinaryFilename(target);
	const execPath = options.execPath ?? process.execPath;
	const executableDirectory = dirname(execPath);
	const cwd = options.cwd ?? process.cwd();
	const platform = options.platform ?? process.platform;
	const bundledPath = join("bin", "remote-helpers", filename);
	return [
		...(env.CLINE_REMOTE_HELPER_DIRECTORY
			? [join(env.CLINE_REMOTE_HELPER_DIRECTORY, filename)]
			: []),
		...(target.platform === "darwin" && platform === "darwin"
			? macCliCandidates(target, resolveDesktopCliPath(env), cwd)
			: []),
		join(executableDirectory, "remote-helpers", filename),
		join(executableDirectory, bundledPath),
		join(executableDirectory, "..", "Resources", bundledPath),
		join(cwd, "src-tauri", bundledPath),
		join(cwd, "apps", "examples", "desktop-app", "src-tauri", bundledPath),
	].find(existsSync);
}
