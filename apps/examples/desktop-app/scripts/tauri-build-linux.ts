// `tauri build` for Linux, with the patchelf guard wired into linuxdeploy.
//
// The AppImage target is not optional here: it is the only Linux bundle the
// Tauri updater can install, so a release without it strands every Linux user
// on the version they first downloaded. Producing one requires linuxdeploy to
// leave the Bun-compiled sidecar alone — see scripts/elf-rewrite-guard.ts.
//
// Every argument is forwarded to the Tauri CLI:
//   bun run scripts/tauri-build-linux.ts --config src-tauri/tauri.release.conf.json

import { chmodSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(import.meta.dir, "..");
const GUARD_SCRIPT = path.join(import.meta.dir, "elf-rewrite-guard.ts");
const APPIMAGE_BUNDLE_DIR = path.join(
	APP_ROOT,
	"src-tauri",
	"target",
	"release",
	"bundle",
	"appimage",
);

const main = async (): Promise<void> => {
	if (process.platform !== "linux") {
		throw new Error(
			`scripts/tauri-build-linux.ts is Linux-only; use \`bun run build:binary\` on ${process.platform}`,
		);
	}

	// linuxdeploy execs $PATCHELF itself, so the guard must carry its
	// executable bit. It is committed with one; re-assert it so a checkout
	// that lost the mode still bundles instead of dying inside linuxdeploy.
	chmodSync(GUARD_SCRIPT, 0o755);

	// Tauri stages the AppDir over whatever a previous run left behind, so a
	// bundle that died mid-way leaves a rewritten sidecar in place and every
	// later build inherits it. Start from nothing.
	if (existsSync(APPIMAGE_BUNDLE_DIR)) {
		for (const entry of readdirSync(APPIMAGE_BUNDLE_DIR)) {
			if (entry.endsWith(".AppDir")) {
				rmSync(path.join(APPIMAGE_BUNDLE_DIR, entry), {
					force: true,
					recursive: true,
				});
			}
		}
	}

	const child = Bun.spawn(
		["bunx", "tauri", "build", ...process.argv.slice(2)],
		{
			cwd: APP_ROOT,
			// linuxdeploy ships its own patchelf inside its AppImage and prefers it
			// over PATH, so $PATCHELF is the only way to interpose on it.
			env: { ...process.env, PATCHELF: GUARD_SCRIPT },
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	const code = await child.exited;
	if (code !== 0) {
		process.exit(code);
	}
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
