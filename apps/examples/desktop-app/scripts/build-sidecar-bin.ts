import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { telemetryDefineArgs } from "./telemetry-define-args";

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

// Bun cross-compiles --compile binaries, so a CI runner can produce the
// sidecar for a different architecture than its own (e.g. the x86_64 macOS
// bundle from an arm64 runner). Without an explicit --target, bun always
// emits a host-arch binary even when Tauri is building for another triple.
const resolveBunCompileTarget = (targetTriple: string): string | undefined => {
	if (targetTriple.startsWith("aarch64-apple-darwin"))
		return "bun-darwin-arm64";
	if (targetTriple.startsWith("x86_64-apple-darwin")) return "bun-darwin-x64";
	if (targetTriple.startsWith("x86_64-pc-windows")) return "bun-windows-x64";
	// SSH hosts may predate AVX2 (e.g. Ivy Bridge Xeons). The default Bun
	// x64 runtime can SIGILL before our entrypoint runs on those CPUs.
	if (targetTriple.startsWith("x86_64-unknown-linux"))
		return "bun-linux-x64-baseline";
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return "bun-linux-arm64";
	return undefined;
};

const sidecarOutfile = (targetTriple: string): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `./src-tauri/bin/code-sidecar-${targetTriple}${extension}`;
};

const buildSidecar = async (
	targetTriple: string,
	outfile = sidecarOutfile(targetTriple),
	entrypoint = "./sidecar/index.ts",
	minify = false,
): Promise<string> => {
	const bunTarget = resolveBunCompileTarget(targetTriple);
	// Telemetry config must be inlined into the compiled binary: a packaged
	// app launched from Finder/the Dock has no OTEL_* env at runtime, so
	// without this the sidecar silently ships with telemetry disabled.
	// Verify with `<binary> --telemetry-selfcheck` after building.
	const defines = telemetryDefineArgs();
	const optimizationArgs = minify ? ["--minify"] : [];
	// A compiled Bun executable otherwise reads .env and bunfig.toml from its
	// launch directory before our entrypoint runs. Remote helpers are launched
	// from an SSH user's home directory, so that behavior can both make the
	// helper fail on an unrelated dotenv file and leak workspace credentials
	// into the Hub process. Packaged binaries must depend only on their explicit
	// process environment and compiled configuration.
	const runtimeIsolationArgs = [
		"--no-compile-autoload-dotenv",
		"--no-compile-autoload-bunfig",
		// Bun only trusts its bundled Mozilla roots on macOS/Windows, so TLS to
		// intranet endpoints signed by a corporate CA (LiteLLM proxies, MITM
		// firewalls) fails with "unable to get local issuer certificate". Bake
		// --use-system-ca into the runtime so the sidecar and the Hub daemon it
		// re-executes from this binary also trust the OS Keychain/cert store,
		// matching the CLI wrapper's OS trust-anchor harvesting.
		"--compile-exec-argv=--use-system-ca",
	];
	if (bunTarget) {
		await $`bun build ${entrypoint} --compile --target=${bunTarget} ${runtimeIsolationArgs} ${optimizationArgs} ${defines} --outfile ${outfile}`;
	} else {
		await $`bun build ${entrypoint} --compile ${runtimeIsolationArgs} ${optimizationArgs} ${defines} --outfile ${outfile}`;
	}
	return outfile;
};

// Each compiled helper embeds a full Bun runtime (~100 MB) around ~14 MB of
// our code, and both helpers ship uncompressed inside every desktop bundle.
// Do not UPX-pack or `strip` them: since Bun 1.4 the runtime lazily reads its
// appended module payload back from its own executable file, so a packed
// helper starts but crashes with "SyntaxError: Invalid character: '\0'" on the
// first lazy read (cline/cline#14815, #14781). `strip` discards the payload.
//
// SSH environments run the same Hub build as the desktop in a dedicated
// bootstrap/daemon binary. It intentionally excludes the desktop HTTP server,
// command router, and UI backend. Linux x64 and arm64 cover common SSH hosts.
// macOS helpers are deliberately not bundled: they are Mach-O files under
// Contents/Resources, which Tauri does not codesign, and any unsigned Mach-O
// in the bundle fails notarization. Mac remotes are served from a macOS
// desktop by its own signed sidecar instead (sidecar/remote-helper.ts).
//
// On a Windows host, Bun fails to extract the downloaded Linux runtime these
// cross-compiles need ("Failed to extract executable for 'bun-linux-x64-…'").
// Bun skips the download when `$BUN_INSTALL_CACHE_DIR/bun-<target>-v<version>`
// already exists, so seed those two files from the @oven/bun-<target> npm
// packages first; desktop-publish.yml does exactly that in its Windows job.
const buildRemoteHelpers = async (): Promise<void> => {
	for (const targetTriple of [
		"x86_64-unknown-linux-gnu",
		"aarch64-unknown-linux-gnu",
	]) {
		await buildSidecar(
			targetTriple,
			`./src-tauri/bin/remote-helpers/cline-remote-helper-${targetTriple}`,
			"../../../sdk/packages/core/dist/remote/remote-helper-entry.js",
			true,
		);
	}
};

// Tauri's universal-apple-darwin pseudo-target lipos the Rust binary itself
// but expects sidecars (externalBin) to already be fat binaries named
// `<name>-universal-apple-darwin`, so build both slices and merge them here.
const buildUniversalMacSidecar = async (): Promise<void> => {
	const arm64 = await buildSidecar("aarch64-apple-darwin");
	const x64 = await buildSidecar("x86_64-apple-darwin");
	const outfile = sidecarOutfile("universal-apple-darwin");
	await $`lipo -create -output ${outfile} ${arm64} ${x64}`;
	await $`chmod +x ${outfile}`;
	await $`lipo -info ${outfile}`;
};

// The plugin sandbox is a subprocess that runs a bootstrap file from disk. The
// compiled sidecar cannot hand its embedded copy to a child process and the
// bundle ships no node_modules, so emit a self-contained bundle (inlines
// @cline/shared and jiti) that Tauri ships as a resource; main.rs points the
// sidecar at it via CLINE_PLUGIN_SANDBOX_BOOTSTRAP_PATH and the Hub daemon
// inherits it. --target=node keeps the bundle runtime-agnostic: the sandbox
// runtime may be a host node, a host bun, or the sidecar re-executing itself
// via BUN_BE_BUN=1 (bun-targeted output uses import.meta.require, which
// breaks under node).
const buildPluginSandboxBootstrap = async (): Promise<void> => {
	const resourceDir = "./src-tauri/extensions";
	await $`mkdir -p ${resourceDir}`;
	await $`bun build ../../../sdk/packages/core/src/extensions/plugin/plugin-sandbox-bootstrap.ts --target=node --outfile ${join(resourceDir, "plugin-sandbox-bootstrap.js")}`;

	// jiti lazily requires its babel transform relative to its own location,
	// which does not survive bundling. The bootstrap prefers a transform
	// resolved from a `node_modules/jiti` found next to itself, so ship the
	// minimal jiti package alongside the bootstrap. jiti is a dependency of
	// @cline/core, not of this app, so resolve it through core's module tree.
	const requireFromCore = createRequire(
		createRequire(import.meta.url).resolve("@cline/core"),
	);
	const jitiPackageDir = dirname(requireFromCore.resolve("jiti/package.json"));
	const jitiResourceDir = join(resourceDir, "node_modules", "jiti");
	await $`mkdir -p ${join(jitiResourceDir, "dist")}`;
	await $`cp ${join(jitiPackageDir, "package.json")} ${jitiResourceDir}`;
	await $`cp ${join(jitiPackageDir, "dist", "babel.cjs")} ${join(jitiResourceDir, "dist")}`;
	await buildPluginHostSdk(resourceDir);
};

// Public SDK entry points a plugin may import. Anything a plugin could
// reasonably `import` is here; process entrypoints (hub daemon, remote helper)
// and optional peer boundaries are not.
const PLUGIN_HOST_SDK_SUBPATHS: Record<string, string[]> = {
	shared: [
		".",
		"./storage",
		"./db",
		"./node",
		"./automation",
		"./remote-config",
	],
	llms: ["."],
	agents: ["."],
	core: [".", "./hub", "./telemetry", "./cloud"],
	sdk: ["."],
};

// Plugins import the host SDK (`import { createTool } from "@cline/core"`).
// The sandbox resolves those specifiers to a `node_modules/@cline/<pkg>` it
// finds next to its bootstrap, which an npm install of the CLI provides and
// the packaged app does not. Ship one self-contained bundle of every public
// SDK entry point (~26 MB, the packages share most of their code) plus a
// tiny CommonJS shim package per @cline/* name whose exports point into it.
const buildPluginHostSdk = async (resourceDir: string): Promise<void> => {
	const sdkPackagesDir = fileURLToPath(
		new URL("../../../../sdk/packages/", import.meta.url),
	);
	const nodeModulesDir = join(resourceDir, "node_modules");
	const bundleDir = join(nodeModulesDir, "cline-host-sdk");
	const bundleFile = join(bundleDir, "index.cjs");
	const namespaceFor = (pkg: string, subpath: string): string =>
		`${pkg}${subpath === "." ? "" : subpath.replace(/\W+/g, "_")}`;

	const entryLines: string[] = [];
	const shims: Array<{
		pkg: string;
		version: string;
		exports: Record<string, string>;
		files: Array<{ name: string; namespace: string }>;
	}> = [];
	for (const [pkg, subpaths] of Object.entries(PLUGIN_HOST_SDK_SUBPATHS)) {
		const packageDir = join(sdkPackagesDir, pkg);
		const manifest = (await Bun.file(
			join(packageDir, "package.json"),
		).json()) as {
			version: string;
			exports: Record<string, { import?: string } | string>;
		};
		const shim: (typeof shims)[number] = {
			pkg,
			version: manifest.version,
			exports: {},
			files: [],
		};
		for (const subpath of subpaths) {
			const exportValue = manifest.exports[subpath];
			const distEntry =
				typeof exportValue === "string" ? exportValue : exportValue?.import;
			if (!distEntry) {
				throw new Error(`@cline/${pkg} has no "${subpath}" export`);
			}
			const namespace = namespaceFor(pkg, subpath);
			entryLines.push(
				`export * as ${namespace} from ${JSON.stringify(join(packageDir, distEntry))};`,
			);
			const fileName =
				subpath === "."
					? "index.cjs"
					: `${subpath.slice(2).replace(/\//g, "-")}.cjs`;
			shim.exports[subpath] = `./${fileName}`;
			shim.files.push({ name: fileName, namespace });
		}
		shims.push(shim);
	}

	await $`mkdir -p ${bundleDir}`;
	const entryFile = join(bundleDir, "entry.ts");
	await Bun.write(entryFile, `${entryLines.join("\n")}\n`);
	await $`bun build ${entryFile} --target=node --format=cjs --minify --outfile ${bundleFile}`;
	await $`rm ${entryFile}`;

	for (const shim of shims) {
		const shimDir = join(nodeModulesDir, "@cline", shim.pkg);
		await $`mkdir -p ${shimDir}`;
		await Bun.write(
			join(shimDir, "package.json"),
			`${JSON.stringify(
				{
					name: `@cline/${shim.pkg}`,
					version: shim.version,
					private: true,
					exports: shim.exports,
				},
				null,
				"\t",
			)}\n`,
		);
		for (const file of shim.files) {
			await Bun.write(
				join(shimDir, file.name),
				`module.exports = require("../../cline-host-sdk/index.cjs").${file.namespace};\n`,
			);
		}
	}
};

const main = async () => {
	// All compiled helpers and the sidecar depend on fresh SDK package exports.
	await $`bun run build:sdk`.cwd(
		fileURLToPath(new URL("../../../../", import.meta.url)),
	);
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p src-tauri/bin src-tauri/bin/remote-helpers`;
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacSidecar();
	} else {
		await buildSidecar(targetTriple);
	}
	await buildRemoteHelpers();
	await buildPluginSandboxBootstrap();
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
