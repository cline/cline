/**
 * Bundle the desktop backend and a compiled `cline` CLI into `dist/` so the
 * packaged extension runs with no bun/node on the user's machine.
 *
 * Mirrors apps/examples/desktop-app/scripts/build-desktop-runtime.ts (the
 * Tauri shell's equivalent) minus the Rust/Tauri parts; nothing here is
 * native code — the CLI binary is Bun's single-file compile of TypeScript.
 *
 *   bun run scripts/build-runtime.ts [--target bun-darwin-arm64]
 *
 * Output:
 *   dist/backend/index.js          sidecar bundle (run by the CLI's runtime)
 *   dist/backend/plugin-runtime/   SDK runtime tree plugins import from
 *   dist/bin/cline-cli[.exe]       compiled Cline CLI (also the Hub daemon)
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import {
	compileCliBinary,
	installOpenTuiNativeVariants,
} from "../../../cli/script/compile-binary";
import { telemetryDefineArgs } from "../../desktop-app/scripts/telemetry-define-args";

const EXT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = resolve(EXT_ROOT, "..", "..", "..");
const DESKTOP_APP = resolve(EXT_ROOT, "..", "desktop-app");
const BACKEND_DIR = join(EXT_ROOT, "dist", "backend");
const BIN_DIR = join(EXT_ROOT, "dist", "bin");

type BunTarget = Parameters<typeof compileCliBinary>[0]["bunTarget"];

function hostTarget(): BunTarget {
	const os =
		process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "windows"
				: "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	return `bun-${os}-${arch}` as BunTarget;
}

const targetArg = process.argv.indexOf("--target");
const target: BunTarget =
	targetArg >= 0 ? (process.argv[targetArg + 1] as BunTarget) : hostTarget();

async function main(): Promise<void> {
	if (!existsSync(join(REPO_ROOT, "sdk/packages/core/dist/plugin-runtime"))) {
		console.log("building SDK…");
		await $`bun run build:sdk`.cwd(REPO_ROOT);
	}

	rmSync(BACKEND_DIR, { recursive: true, force: true });
	rmSync(BIN_DIR, { recursive: true, force: true });
	mkdirSync(BACKEND_DIR, { recursive: true });
	mkdirSync(BIN_DIR, { recursive: true });

	console.log("bundling desktop backend…");
	const defines = telemetryDefineArgs();
	await $`bun build ./sidecar/index.ts --target bun --minify ${defines} --outfile ${join(BACKEND_DIR, "index.js")}`.cwd(
		DESKTOP_APP,
	);
	cpSync(
		join(REPO_ROOT, "sdk/packages/core/dist/plugin-runtime"),
		join(BACKEND_DIR, "plugin-runtime"),
		{ recursive: true },
	);

	console.log(`compiling cline CLI for ${target}…`);
	// Installs every OS/CPU variant of the native deps, so cross-compiling
	// (e.g. a Windows VSIX from a Mac) picks up the right one.
	await installOpenTuiNativeVariants();
	const outfile = join(BIN_DIR, target.includes("windows") ? "cline-cli.exe" : "cline-cli");
	await compileCliBinary({
		bunTarget: target,
		outfile,
		autoloadLaunchDirectoryConfig: false,
		execArgv: ["--use-system-ca"],
	});
	await $`chmod +x ${outfile}`.nothrow();
	const size = (await $`du -sh ${outfile}`.text()).trim();
	console.log(`runtime ready: ${size}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
