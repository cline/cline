#!/usr/bin/env bun

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { platform as osPlatform } from "node:os";
import { join, relative, resolve } from "node:path";
import { $ } from "bun";
import {
	parseBuildOptions,
	shouldInstallNativeVariants,
	validateBuildOptions,
} from "./build-options";

const cliDir = resolve(import.meta.dir, "..");
const rootDir = resolve(cliDir, "../..");
process.chdir(cliDir);

// Telemetry / OTEL environment variables that should be baked into the
// compiled binary at build time. Mirrors the list of secrets injected by the
// `cli-publish` GitHub Actions workflow. These are inlined via Bun's `define`
// so the CLI ships with the production telemetry configuration without
// requiring the end user to set any env vars.
const BUILD_TIME_INLINED_ENV_VARS = [
	"TELEMETRY_SERVICE_API_KEY",
	"ERROR_SERVICE_API_KEY",
	"OTEL_TELEMETRY_ENABLED",
	"OTEL_LOGS_EXPORTER",
	"OTEL_METRICS_EXPORTER",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
] as const;

function buildInlinedEnvDefines(): Record<string, string> {
	const defines: Record<string, string> = {};
	for (const name of BUILD_TIME_INLINED_ENV_VARS) {
		defines[`process.env.${name}`] = JSON.stringify(process.env[name] ?? "");
	}
	return defines;
}

// Why: Detect AVX2 at build time so the smoke test can skip the standard x64
// binary on no-AVX2 hosts (it would SIGILL and fail the build) and instead
// run the baseline x64 binary when it is present.
// What: Returns true when /proc/cpuinfo contains "avx2" as a whole word.
// On non-Linux hosts (where /proc/cpuinfo doesn't exist) returns true.
// Test: On a Sandy Bridge host (avx but no avx2), buildHostHasAvx2() returns false.
function buildHostHasAvx2(): boolean {
	if (osPlatform() !== "linux") {
		return true;
	}
	try {
		const cpuinfo = readFileSync("/proc/cpuinfo", "utf-8");
		return /(^|\s)avx2(\s|$)/m.test(cpuinfo);
	} catch {
		return true;
	}
}

const hostHasAvx2 = buildHostHasAvx2();

const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf-8"));
const version: string = pkg.version;
const repository: unknown = pkg.repository;

console.log(`Building @cline/cli v${version}`);

const buildOptions = parseBuildOptions(process.argv.slice(2));

// "baseline" variant: compiled with bun-linux-x64-baseline / bun-windows-x64-baseline.
// These binaries use the x86-64-v2 instruction set (no AVX2) and are required on
// older Intel CPUs such as Sandy Bridge (issue #10514). Only x64 Linux and Windows
// are affected; macOS does not run on non-AVX2 x64 hardware in practice.
const allTargets: {
	os: string;
	arch: "arm64" | "x64";
	variant?: "baseline";
}[] = [
	{ os: "linux", arch: "arm64" },
	{ os: "linux", arch: "x64" },
	{ os: "linux", arch: "x64", variant: "baseline" },
	{ os: "darwin", arch: "arm64" },
	{ os: "darwin", arch: "x64" },
	{ os: "win32", arch: "x64" },
	{ os: "win32", arch: "x64", variant: "baseline" },
	{ os: "win32", arch: "arm64" },
];

const targets = buildOptions.single
	? allTargets.filter(
			(item) => item.os === process.platform && item.arch === process.arch,
		)
	: allTargets;

const opentuiVersion = pkg.dependencies["@opentui/core"];
const optionsError = validateBuildOptions({
	options: buildOptions,
	opentuiVersion,
	targetCount: targets.length,
});
if (optionsError) {
	console.error(optionsError);
	process.exit(1);
}

await $`rm -rf dist`;

// Pre-install all platform variants of native packages so cross-compilation
// can resolve them. Without this, Bun only has the host platform's native
// binary and cross-compiled builds fail to resolve @opentui/core's FFI layer.
if (shouldInstallNativeVariants({ options: buildOptions, opentuiVersion })) {
	console.log(
		`Installing all platform variants of @opentui/core@${opentuiVersion}...`,
	);
	await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion}`;
}

// Build the SDK first (the CLI bundles workspace packages)
if (!buildOptions.skipSdkBuild) {
	console.log("Building SDK packages...");
	await $`bun run build:sdk`.cwd(rootDir);

	console.log("Building CLI bundle...");
	await $`bun -F @cline/cli build`.cwd(rootDir);
}

const hubWebviewSource = join(cliDir, "../cline-hub/src/webview");
const hubWebviewDist = join(cliDir, "../cline-hub/dist/webview");
const hubWebviewIndex = join(hubWebviewDist, "index.html");

function newestFileMtimeMs(dir: string): number {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (
			entry.name === "node_modules" ||
			entry.name === "dist" ||
			entry.name === ".turbo"
		) {
			continue;
		}
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			newest = Math.max(newest, newestFileMtimeMs(path));
		} else if (entry.isFile()) {
			newest = Math.max(newest, statSync(path).mtimeMs);
		}
	}
	return newest;
}

function shouldBuildHubWebview(): boolean {
	if (!existsSync(hubWebviewIndex)) {
		return true;
	}
	try {
		return (
			newestFileMtimeMs(hubWebviewSource) > statSync(hubWebviewIndex).mtimeMs
		);
	} catch {
		return true;
	}
}

if (shouldBuildHubWebview()) {
	console.log("Building Cline Hub webview...");
	await $`bun -F @cline/cline-hub build:webview`.cwd(rootDir);
}

const binaries: Record<string, string> = {};

function findOpenTuiParserWorker(): string {
	const localPath = resolve(
		cliDir,
		"node_modules/@opentui/core/parser.worker.js",
	);
	const rootPath = resolve(
		rootDir,
		"node_modules/@opentui/core/parser.worker.js",
	);
	const parserWorkerPath = existsSync(localPath) ? localPath : rootPath;
	return realpathSync(parserWorkerPath);
}

function getBunTarget(
	item: (typeof allTargets)[number],
): Bun.Build.CompileTarget {
	const targetOs = item.os === "win32" ? "windows" : item.os;
	// Append "-baseline" for baseline variants so Bun embeds the no-AVX2 runtime.
	const suffix = item.variant === "baseline" ? "-baseline" : "";
	return `bun-${targetOs}-${item.arch}${suffix}` as Bun.Build.CompileTarget;
}

async function buildCompiledBinary(input: {
	bunTarget: Bun.Build.CompileTarget;
	dirName: string;
	outfile: string;
}): Promise<void> {
	const parserWorker = findOpenTuiParserWorker();
	const targetOs = input.bunTarget.includes("windows") ? "windows" : "posix";
	const bunfsRoot = targetOs === "windows" ? "B:/~BUN/root/" : "/$bunfs/root/";
	const parserWorkerPath = relative(rootDir, parserWorker).replaceAll(
		"\\",
		"/",
	);

	// Build to /tmp first so Bun's temp-file rename stays on one filesystem
	// layer in containerized environments (virtiofs, overlayfs).
	const entrypoint = join(cliDir, "src/index.ts");
	const tmpDir = join("/tmp", `cline-build-${input.dirName}`);
	const tmpOutfile = join(
		tmpDir,
		input.outfile.endsWith(".exe") ? "cline.exe" : "cline",
	);
	mkdirSync(tmpDir, { recursive: true });

	process.chdir("/tmp");
	const result = await Bun.build({
		entrypoints: [entrypoint, parserWorker],
		splitting: true,
		compile: {
			target: input.bunTarget,
			outfile: tmpOutfile,
		},
		minify: true,
		external: ["@anthropic-ai/vertex-sdk"],
		define: {
			OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + parserWorkerPath,
			// Inline telemetry/OTEL env vars at build time so the compiled
			// binary ships with production telemetry configuration baked in.
			...buildInlinedEnvDefines(),
		},
		throw: false,
	});
	process.chdir(cliDir);

	if (!result.success) {
		console.error(`Build failed for ${input.dirName}:`);
		for (const log of result.logs) {
			console.error(log);
		}
		process.exit(1);
	}

	await $`cp ${tmpOutfile} ${input.outfile} && chmod 755 ${input.outfile}`;
	await $`rm -rf ${tmpDir}`;
}

for (const item of targets) {
	// npm treats "win32" specially in os field, but for package naming use "windows"
	const displayOs = item.os === "win32" ? "windows" : item.os;
	// Baseline variants get a "-baseline" suffix in both the package name and
	// directory name so they can coexist alongside the standard packages.
	const variantSuffix = item.variant === "baseline" ? "-baseline" : "";
	const name = `@cline/cli-${displayOs}-${item.arch}${variantSuffix}`;
	const dirName = `cli-${displayOs}-${item.arch}${variantSuffix}`;
	const binaryName = item.os === "win32" ? "cline.exe" : "cline";
	const bunTarget = getBunTarget(item);

	console.log(`\nBuilding ${name} (target: ${bunTarget})...`);
	const outDir = join(cliDir, `dist/${dirName}/bin`);
	mkdirSync(outDir, { recursive: true });

	const outfile = join(outDir, binaryName);

	await buildCompiledBinary({ bunTarget, dirName, outfile });

	// Smoke test: only run on current platform.
	// On x64 Linux without AVX2 (e.g. Sandy Bridge / Xeon E5-2620 v1), the
	// standard x64 binary requires AVX2 and will SIGILL immediately — which
	// would fail the build on a host that is working correctly. When AVX2 is
	// absent we skip the standard x64 smoke test with a warning and instead
	// run the baseline x64 binary (if it was just built) to prove the build
	// produced a working artifact. On AVX2-capable hosts all smoke tests run
	// normally.
	if (item.os === process.platform && item.arch === process.arch) {
		const isStandardX64 = item.arch === "x64" && item.variant !== "baseline";
		const skipBecauseNoAvx2 =
			isStandardX64 && process.platform === "linux" && !hostHasAvx2;

		if (skipBecauseNoAvx2) {
			console.warn(
				`  WARNING: Skipping smoke test for ${name} — ` +
					`build host lacks AVX2 (standard x64 binary would SIGILL). ` +
					`The baseline x64 binary will be smoke-tested instead.`,
			);
		} else if (
			item.arch === "x64" &&
			item.variant === "baseline" &&
			!hostHasAvx2
		) {
			// On a no-AVX2 host, run the baseline binary as the smoke test substitute.
			console.log(`  Smoke test (baseline substitute): ${outfile} --version`);
			try {
				const output = await $`${outfile} --version`.text();
				const actualVersion = output.trim();
				if (actualVersion !== version) {
					throw new Error(
						`Expected --version to print ${version}, got ${actualVersion}`,
					);
				}
				console.log(`  Passed (baseline): ${actualVersion}`);
			} catch (e) {
				console.error(`  Smoke test FAILED for ${name}:`, e);
				process.exit(1);
			}
		} else {
			console.log(`  Smoke test: ${outfile} --version`);
			try {
				const output = await $`${outfile} --version`.text();
				const actualVersion = output.trim();
				if (actualVersion !== version) {
					throw new Error(
						`Expected --version to print ${version}, got ${actualVersion}`,
					);
				}
				console.log(`  Passed: ${actualVersion}`);
			} catch (e) {
				console.error(`  Smoke test FAILED for ${name}:`, e);
				process.exit(1);
			}
		}
	}

	// Copy plugin sandbox bootstrap if it exists
	const bootstrapSrc = join(
		rootDir,
		"sdk/packages/core/dist/extensions/plugin-sandbox-bootstrap.js",
	);
	if (existsSync(bootstrapSrc)) {
		const bootstrapDir = join(cliDir, `dist/${dirName}/extensions`);
		mkdirSync(bootstrapDir, { recursive: true });
		const content = readFileSync(bootstrapSrc);
		await Bun.write(join(bootstrapDir, "plugin-sandbox-bootstrap.js"), content);
	}

	if (existsSync(hubWebviewDist)) {
		const hubWebviewDest = join(cliDir, `dist/${dirName}/cline-hub/webview`);
		mkdirSync(join(cliDir, `dist/${dirName}/cline-hub`), {
			recursive: true,
		});
		cpSync(hubWebviewDist, hubWebviewDest, { recursive: true });
	}

	// Generate platform package.json
	const descriptionSuffix =
		item.variant === "baseline" ? " (baseline / no-AVX2)" : "";
	await Bun.write(
		join(cliDir, `dist/${dirName}/package.json`),
		`${JSON.stringify(
			{
				name,
				version,
				description: `Cline CLI binary for ${displayOs} ${item.arch}${descriptionSuffix}`,
				os: [item.os],
				// cpu still lists the base architecture; the "-baseline" suffix in the
				// package name is the signal to npm that this variant targets no-AVX2.
				cpu: [item.arch],
				...(repository ? { repository } : {}),
				bin: {
					cline: `bin/${binaryName}`,
				},
			},
			null,
			2,
		)}\n`,
	);

	binaries[name] = version;
	console.log(`  Built ${name}`);
}

console.log(`\nBuild complete. ${Object.keys(binaries).length} targets built.`);
console.log("Packages:");
for (const [name, ver] of Object.entries(binaries)) {
	console.log(`  ${name}@${ver}`);
}

export { binaries, version };
