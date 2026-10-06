import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import {
	compileCliBinary,
	installOpenTuiNativeVariants,
} from "../../../cli/script/compile-binary";
import { telemetryDefineArgs } from "./telemetry-define-args";

// The desktop app ships two runtime artifacts and no app-specific executable:
//
// - The Cline CLI, compiled self-contained for this target (Tauri externalBin
//   `bin/cline-cli`). `cline-cli hub ensure` starts or reuses the CLI-managed
//   Hub, and the Hub daemon is that same binary.
// - The desktop backend (sidecar/ sources: the UI command router plus its
//   HTTP/WebSocket server) as one JS bundle, executed on the CLI's embedded
//   runtime. It attaches to the Hub as an ordinary client.
//
// Linux CLI copies are bundled as resources so SSH remotes run a CLI-managed
// Hub too; macOS remotes reuse the signed universal CLI itself.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BIN_DIR = "src-tauri/bin";
export const DESKTOP_CLI_NAME = "cline-cli";
export const DESKTOP_BACKEND_BUNDLE = `${BIN_DIR}/desktop-backend/index.js`;
export const REMOTE_CLI_DIR = `${BIN_DIR}/remote-helpers`;

const resolveTargetTriple = async (): Promise<string> => {
	const fromEnv = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.TARGET;
	if (fromEnv?.trim()) {
		return fromEnv.trim();
	}

	const rustcVersion = await $`rustc -vV`.text();
	const hostLine = rustcVersion
		.split("\n")
		.find((line) => line.startsWith("host: "));
	const host = hostLine?.slice("host: ".length).trim();
	if (!host) {
		throw new Error("failed to resolve Rust host target triple");
	}
	return host;
};

// Bun cross-compiles --compile binaries, so a CI runner can produce the CLI
// for a different architecture than its own (e.g. the x86_64 macOS bundle
// from an arm64 runner).
const resolveBunCompileTarget = (
	targetTriple: string,
): Bun.Build.CompileTarget => {
	if (targetTriple.startsWith("aarch64-apple-darwin"))
		return "bun-darwin-arm64";
	if (targetTriple.startsWith("x86_64-apple-darwin")) return "bun-darwin-x64";
	if (targetTriple.startsWith("x86_64-pc-windows")) return "bun-windows-x64";
	if (targetTriple.startsWith("aarch64-pc-windows")) return "bun-windows-arm64";
	// SSH hosts may predate AVX2 (e.g. Ivy Bridge Xeons). The default Bun
	// x64 runtime can SIGILL before our entrypoint runs on those CPUs.
	if (targetTriple.startsWith("x86_64-unknown-linux"))
		return "bun-linux-x64-baseline";
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return "bun-linux-arm64";
	throw new Error(`unsupported desktop target triple: ${targetTriple}`);
};

const desktopCliOutfile = (targetTriple: string): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `${BIN_DIR}/${DESKTOP_CLI_NAME}-${targetTriple}${extension}`;
};

const compileDesktopCli = async (
	targetTriple: string,
	outfile = desktopCliOutfile(targetTriple),
): Promise<string> => {
	await compileCliBinary({
		bunTarget: resolveBunCompileTarget(targetTriple),
		outfile: fileURLToPath(new URL(`../${outfile}`, import.meta.url)),
		// A packaged app and an SSH session launch the CLI from directories the
		// user did not choose (/, an SSH home). Reading .env or bunfig.toml
		// from there could fail startup or leak credentials into the Hub.
		autoloadLaunchDirectoryConfig: false,
		// Bun only trusts its bundled Mozilla roots on macOS/Windows, so TLS to
		// intranet endpoints signed by a corporate CA (LiteLLM proxies, MITM
		// firewalls) fails with "unable to get local issuer certificate". Bake
		// --use-system-ca in so the Hub and the backend running on this runtime
		// also trust the OS Keychain/cert store, as the npm wrapper does.
		execArgv: ["--use-system-ca"],
	});
	return outfile;
};

const bundleDesktopBackend = async (): Promise<void> => {
	// Telemetry config must be inlined into the bundle: a packaged app launched
	// from Finder/the Dock has no OTEL_* env at runtime, so without this the
	// backend silently ships with telemetry disabled. Verify with
	// `BUN_BE_BUN=1 cline-cli run <bundle> --telemetry-selfcheck`.
	const defines = telemetryDefineArgs();
	await $`bun build ./sidecar/index.ts --target bun --minify ${defines} --outfile ${DESKTOP_BACKEND_BUNDLE}`;
};

// Each compiled CLI embeds a full Bun runtime (~100 MB), and both Linux copies
// ship inside every desktop bundle. UPX packs the ELF in place to about a
// quarter of its size and it self-extracts in memory on launch, so the
// installer, the SSH upload, and the remote run all see one ordinary
// executable. `strip` is not an option here; it discards Bun's appended
// module payload. Requires upx on PATH; the publish workflow installs it on
// every runner.
const compressRemoteCli = async (outfile: string): Promise<void> => {
	if (!Bun.which("upx")) {
		if (process.env.CI) {
			throw new Error(
				`upx is required to compress ${outfile} but was not found on PATH`,
			);
		}
		console.warn(
			`upx not found on PATH; leaving ${outfile} uncompressed (only the packaged size is affected)`,
		);
		return;
	}
	await $`upx --best --lzma -q ${outfile}`;
};

// Linux x64 and arm64 cover common SSH hosts. macOS copies are deliberately
// not bundled: they would be Mach-O files under Contents/Resources, which
// Tauri does not codesign, and any unsigned Mach-O in the bundle fails
// notarization. Mac remotes are served by the signed desktop CLI instead
// (sidecar/remote-helper.ts).
//
// On a Windows host, Bun fails to extract the downloaded Linux runtime these
// cross-compiles need ("Failed to extract executable for 'bun-linux-x64-…'").
// Bun skips the download when `$BUN_INSTALL_CACHE_DIR/bun-<target>-v<version>`
// already exists, so seed those two files from the @oven/bun-<target> npm
// packages first; desktop-publish.yml does exactly that in its Windows job.
const buildRemoteClis = async (): Promise<void> => {
	for (const targetTriple of [
		"x86_64-unknown-linux-gnu",
		"aarch64-unknown-linux-gnu",
	]) {
		const outfile = await compileDesktopCli(
			targetTriple,
			`${REMOTE_CLI_DIR}/cline-${targetTriple}`,
		);
		await compressRemoteCli(outfile);
	}
};

// Tauri's universal-apple-darwin pseudo-target lipos the Rust binary itself
// but expects externalBin binaries to already be fat binaries named
// `<name>-universal-apple-darwin`, so build both slices and merge them here.
const buildUniversalMacCli = async (): Promise<void> => {
	const arm64 = await compileDesktopCli("aarch64-apple-darwin");
	const x64 = await compileDesktopCli("x86_64-apple-darwin");
	const outfile = desktopCliOutfile("universal-apple-darwin");
	await $`lipo -create -output ${outfile} ${arm64} ${x64}`;
	await $`chmod +x ${outfile}`;
	await $`lipo -info ${outfile}`;
};

const hasOpenTuiNativeVariant = (os: string, arch: string): boolean =>
	existsSync(`${REPO_ROOT}/node_modules/.bun`) &&
	[
		...new Bun.Glob(`@opentui+core-${os}-${arch}@*`).scanSync({
			cwd: `${REPO_ROOT}/node_modules/.bun`,
			onlyFiles: false,
		}),
	].length > 0;

const main = async () => {
	// The CLI, its Hub daemon, and the backend bundle must all carry the same
	// SDK build identity, so build the SDK packages they bundle once, first.
	await $`bun run build:sdk`.cwd(REPO_ROOT);
	process.chdir(APP_ROOT);
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p ${BIN_DIR}/desktop-backend ${REMOTE_CLI_DIR}`;
	// Every build cross-compiles the Linux SSH copies (and macOS builds both
	// architectures), which needs the target platforms' OpenTUI native
	// packages in addition to the host's.
	const needed: Array<[string, string]> = [
		["linux", "x64"],
		["linux", "arm64"],
		...(targetTriple === "universal-apple-darwin"
			? ([
					["darwin", "x64"],
					["darwin", "arm64"],
				] as Array<[string, string]>)
			: []),
	];
	if (needed.some(([os, arch]) => !hasOpenTuiNativeVariant(os, arch))) {
		await installOpenTuiNativeVariants();
	}
	await bundleDesktopBackend();
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacCli();
	} else {
		await compileDesktopCli(targetTriple);
	}
	await buildRemoteClis();
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
