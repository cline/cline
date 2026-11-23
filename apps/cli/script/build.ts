#!/usr/bin/env bun

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
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
import { writeCliThirdPartyNotices } from "./third-party-notices";

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

rmSync(join(cliDir, "dist"), { recursive: true, force: true });

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

/**
 * The binary must take no configuration from the directory it is launched in.
 * Run it in a directory holding a `bunfig.toml` preload and a `.env` that
 * redirects the MCP settings file, and fail the build if either is honoured.
 */
async function assertIgnoresLaunchDirectoryConfig(
	binary: string,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "cline-smoke-launch-dir-"));
	try {
		const home = join(dir, "home");
		const launchDir = join(dir, "project");
		mkdirSync(home);
		mkdirSync(launchDir);
		const preloadMarker = join(launchDir, "preload-ran");
		writeFileSync(
			join(launchDir, "bunfig.toml"),
			'preload = ["./preload.js"]\n',
		);
		writeFileSync(
			join(launchDir, "preload.js"),
			`require("node:fs").writeFileSync(${JSON.stringify(preloadMarker)}, "");\n`,
		);
		const envFileServer = "launch-dir-env-file";
		for (const name of [".env", ".env.local"]) {
			writeFileSync(
				join(launchDir, name),
				"CLINE_MCP_SETTINGS_PATH=./mcp.json\n",
			);
		}
		writeFileSync(
			join(launchDir, "mcp.json"),
			JSON.stringify({ mcpServers: { [envFileServer]: { command: "true" } } }),
		);

		const env: Record<string, string | undefined> = {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			CLINE_DIR: join(home, ".cline"),
			CLINE_DATA_DIR: join(home, "data"),
		};
		delete env.CLINE_MCP_SETTINGS_PATH;

		// `config mcp` only reads the settings file; bare `config` would start
		// a background hub.
		const servers = JSON.parse(
			await $`${binary} config mcp --json`.cwd(launchDir).env(env).text(),
		) as { name?: string }[];
		if (existsSync(preloadMarker)) {
			throw new Error("The binary ran a bunfig.toml preload from its cwd");
		}
		if (servers.some((server) => server.name === envFileServer)) {
			throw new Error("The binary loaded a .env file from its cwd");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
	}
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
		const { bundleInputs } = await compileCliBinary({ bunTarget, outfile });
		writeCliThirdPartyNotices({
			product: "Cline CLI",
			bundleInputs,
			outFile: join(cliDir, `dist/${dirName}/THIRD_PARTY_NOTICES.txt`),
		});
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

			await assertIgnoresLaunchDirectoryConfig(outfile);

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
				try {
					rmSync(smokeHome, {
						recursive: true,
						force: true,
						maxRetries: 10,
						retryDelay: 100,
					});
				} catch (cleanupError) {
					console.warn(
						`  Warning: failed to remove smoke test dir ${smokeHome}:`,
						cleanupError,
					);
				}
			}
		} catch (e) {
			console.error(`  Smoke test FAILED for ${name}:`, e);
			process.exit(1);
		}
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
