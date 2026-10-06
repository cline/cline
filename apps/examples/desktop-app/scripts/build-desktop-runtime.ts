import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import {
	compileCliBinary,
	installOpenTuiNativeVariants,
} from "../../../cli/script/compile-binary";
import { telemetryDefineArgs } from "./telemetry-define-args";

// Build the release CLI separately from the app resources. The app ships
// the backend JS and installer scripts; first launch downloads this release's
// CLI into a versioned per-user cache. Local development uses the build output.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BIN_DIR = "src-tauri/bin";
export const DESKTOP_CLI_NAME = "cline-cli";
export const DESKTOP_BACKEND_BUNDLE = `${BIN_DIR}/desktop-backend/index.js`;

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

// Build a universal runtime asset for both local and SSH macOS hosts.
// Tauri only merges the main app; this executable is published separately.
const buildUniversalMacCli = async (): Promise<void> => {
	const arm64 = await compileDesktopCli("aarch64-apple-darwin");
	const x64 = await compileDesktopCli("x86_64-apple-darwin");
	const outfile = desktopCliOutfile("universal-apple-darwin");
	await $`lipo -create -output ${outfile} ${arm64} ${x64}`;
	await $`chmod +x ${outfile}`;
	await $`lipo -info ${outfile}`;
};

const main = async () => {
	// The CLI, its Hub daemon, and the backend bundle must all carry the same
	// SDK build identity, so build the SDK packages they bundle once, first.
	await $`bun run build:sdk`.cwd(REPO_ROOT);
	process.chdir(APP_ROOT);
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p ${BIN_DIR}/desktop-backend`;
	if (targetTriple === "universal-apple-darwin") {
		await installOpenTuiNativeVariants();
	}
	const installerDir = `${BIN_DIR}/cli-installer`;
	mkdirSync(installerDir, { recursive: true });
	cpSync("scripts/cli-installer", installerDir, { recursive: true });
	const { version } = JSON.parse(readFileSync("package.json", "utf8"));
	const nightlyStamp = version.match(/-nightly\.([0-9]+)/)?.[1];
	const release = nightlyStamp
		? `desktop-nightly-${nightlyStamp}`
		: `desktop-v${version}`;
	writeFileSync(`${installerDir}/release.txt`, `${release}\n`);
	// Read the SDK identity in a fresh process after build:sdk, avoiding a
	// previously imported dist module when the build changed its fingerprint.
	const identity =
		await $`bun -e 'import { resolveHubBuildIdentity } from "@cline/core/hub"; console.log(JSON.stringify(resolveHubBuildIdentity()))'`.text();
	writeFileSync(`${installerDir}/identity.json`, identity);
	await bundleDesktopBackend();
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacCli();
	} else {
		await compileDesktopCli(targetTriple);
	}
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
