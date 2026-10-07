#!/usr/bin/env bun

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import {
	parseBuildOptions,
	shouldInstallNativeVariants,
	validateBuildOptions,
} from "./build-options";
import {
	compileCliBinary,
	installOpenTuiNativeVariants,
} from "./compile-binary";
import { buildDashboardRuntimeResources } from "./dashboard-runtime";

const cliDir = resolve(import.meta.dir, "..");
const rootDir = resolve(cliDir, "../..");
process.chdir(cliDir);

const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf-8"));
const version: string = pkg.version;
const repository: unknown = pkg.repository;

console.log(`Building @cline/cli v${version}`);

const buildOptions = parseBuildOptions(process.argv.slice(2));

const allTargets: {
	os: string;
	arch: "arm64" | "x64";
}[] = [
	{ os: "linux", arch: "arm64" },
	{ os: "linux", arch: "x64" },
	{ os: "darwin", arch: "arm64" },
	{ os: "darwin", arch: "x64" },
	{ os: "win32", arch: "x64" },
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
	await installOpenTuiNativeVariants();
}

// Build the SDK first (the CLI bundles workspace packages)
if (!buildOptions.skipSdkBuild) {
	console.log("Building SDK packages...");
	await $`bun run build:sdk`.cwd(rootDir);

	console.log("Building CLI bundle...");
	await $`bun -F @cline/cli build`.cwd(rootDir);
}

const hubWebviewDist = join(cliDir, "../cline-hub/dist/webview");
await buildDashboardRuntimeResources();

const binaries: Record<string, string> = {};

function findFreePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolvePort(port));
		});
	});
}

function getBunTarget(
	item: (typeof allTargets)[number],
): Bun.Build.CompileTarget {
	const targetOs = item.os === "win32" ? "windows" : item.os;
	return `bun-${targetOs}-${item.arch}` as Bun.Build.CompileTarget;
}

for (const item of targets) {
	// npm treats "win32" specially in os field, but for package naming use "windows"
	const displayOs = item.os === "win32" ? "windows" : item.os;
	const name = `@cline/cli-${displayOs}-${item.arch}`;
	const dirName = `cli-${displayOs}-${item.arch}`;
	const binaryName = item.os === "win32" ? "cline.exe" : "cline";
	const bunTarget = getBunTarget(item);

	console.log(`\nBuilding ${name} (target: ${bunTarget})...`);
	const outDir = join(cliDir, `dist/${dirName}/bin`);
	mkdirSync(outDir, { recursive: true });

	const outfile = join(outDir, binaryName);

	try {
		await compileCliBinary({ bunTarget, outfile });
	} catch (error) {
		console.error(`Build failed for ${dirName}:`, error);
		process.exit(1);
	}

	// Smoke test: only run on current platform
	if (item.os === process.platform && item.arch === process.arch) {
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

			// `--version` only proves the binary launches. Bun's bundler has had
			// compile-time regressions (chunk ordering with `splitting: true`)
			// that only surface once real modules load, so also boot the hub
			// daemon from this binary in an isolated data dir and confirm it
			// answers a health probe before shipping.
			console.log(`  Smoke test: ${outfile} hub start/status/stop`);
			const smokeHome = mkdtempSync(join(tmpdir(), "cline-smoke-"));
			const smokeEnv = {
				...process.env,
				HOME: smokeHome,
				USERPROFILE: smokeHome,
				CLINE_DIR: join(smokeHome, ".cline"),
				CLINE_DATA_DIR: join(smokeHome, "data"),
				// Keep clear of a developer's real hub: its discovery record
				// (which CLINE_HUB_DISCOVERY_PATH can point anywhere) and the
				// default port.
				CLINE_HUB_DISCOVERY_PATH: join(smokeHome, "hub-discovery.json"),
				CLINE_HUB_PORT: String(await findFreePort()),
			};
			try {
				await $`${outfile} hub start`.env(smokeEnv).quiet();
				const status = JSON.parse(
					await $`${outfile} hub status`.env(smokeEnv).text(),
				) as { running?: boolean; coreVersion?: string };
				if (!status.running || !status.coreVersion) {
					throw new Error(
						`Expected a healthy hub, got ${JSON.stringify(status)}`,
					);
				}
				console.log(`  Passed: hub core ${status.coreVersion}`);
			} finally {
				await $`${outfile} hub stop`.env(smokeEnv).quiet().nothrow();
				rmSync(smokeHome, { recursive: true, force: true });
			}
		} catch (e) {
			console.error(`  Smoke test FAILED for ${name}:`, e);
			process.exit(1);
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
	await Bun.write(
		join(cliDir, `dist/${dirName}/package.json`),
		`${JSON.stringify(
			{
				name,
				version,
				description: `Cline CLI binary for ${displayOs} ${item.arch}`,
				os: [item.os],
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
