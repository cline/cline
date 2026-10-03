import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Locates the Cline CLI binary bundled with the desktop app and points Core's
 * Hub daemon launcher at it.
 *
 * The desktop backend does not host a Hub daemon personality of its own. Core
 * spawns the daemon from this binary instead, which keeps exactly one copy of
 * the runtime responsible for being the Hub. The CLI is a self-contained
 * compiled executable, so the user needs no Bun or Node installed.
 *
 * The bundled CLI must be built from the same checkout as this app: the Hub
 * build id fingerprints the SDK sources, and a daemon reporting a different
 * build id would be treated as a foreign Hub by the reuse/retire ordering.
 */

const CLI_BINARY_NAME = process.platform === "win32" ? "cline.exe" : "cline";
const HUB_LAUNCHER_BINARY_ENV = "CLINE_HUB_LAUNCHER_BINARY";

// Tauri's Linux bundles install binaries under `usr/bin` and resources under
// `usr/lib/<productName>`, and the product name differs per release channel
// ("Cline", "Cline Beta"), so scan the sibling lib directory.
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

export function resolveBundledCliBinary(
	options: {
		execPath?: string;
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		exists?: (path: string) => boolean;
	} = {},
): string | undefined {
	const env = options.env ?? process.env;
	const configured = env[HUB_LAUNCHER_BINARY_ENV]?.trim();
	if (configured) {
		return configured;
	}
	const exists = options.exists ?? existsSync;
	const executableDirectory = dirname(options.execPath ?? process.execPath);
	const cwd = options.cwd ?? process.cwd();
	const bundledPath = join("bin", CLI_BINARY_NAME);
	return [
		// Packaged next to the app executable (Windows, Linux `usr/bin`).
		join(executableDirectory, CLI_BINARY_NAME),
		join(executableDirectory, bundledPath),
		// macOS: Contents/MacOS/<exe> -> Contents/Resources/bin/cline
		join(executableDirectory, "..", "Resources", bundledPath),
		...linuxResourceCandidates(executableDirectory, bundledPath),
		// `tauri dev` and `bun run dev:sidecar`, where the app runs from source.
		join(cwd, "src-tauri", bundledPath),
		join(cwd, "apps", "examples", "desktop-app", "src-tauri", bundledPath),
	].find(exists);
}

/**
 * Publish the bundled CLI as the Hub daemon launcher for this process and
 * every child that inherits its environment. Returns the resolved path, or
 * undefined when no bundled CLI is present — in which case Core falls back to
 * spawning the daemon from the current executable.
 */
export function configureHubLauncher(
	options: Parameters<typeof resolveBundledCliBinary>[0] = {},
): string | undefined {
	const binary = resolveBundledCliBinary(options);
	if (binary) {
		(options.env ?? process.env)[HUB_LAUNCHER_BINARY_ENV] = binary;
	}
	return binary;
}
