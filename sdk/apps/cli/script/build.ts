#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import {
	parseBuildOptions,
	shouldInstallNativeVariants,
	validateBuildOptions,
} from "./build-options";

const cliDir = resolve(import.meta.dir, "..");
const rootDir = resolve(cliDir, "../..");
process.chdir(cliDir);

const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf-8"));
const version: string = pkg.version;
const repository: unknown = pkg.repository;

console.log(`Building @clinebot/cli v${version}`);

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
	await $`bun -F @clinebot/cli build`.cwd(rootDir);
}

const binaries: Record<string, string> = {};

for (const item of targets) {
	// npm treats "win32" specially in os field, but for package naming use "windows"
	const displayOs = item.os === "win32" ? "windows" : item.os;
	const name = `@clinebot/cli-${displayOs}-${item.arch}`;
	const dirName = `cli-${displayOs}-${item.arch}`;
	const binaryName = item.os === "win32" ? "clite.exe" : "clite";
	const bunTarget = `bun-${item.os === "win32" ? "windows" : item.os}-${item.arch}`;

	console.log(`\nBuilding ${name} (target: ${bunTarget})...`);
	const outDir = join(cliDir, `dist/${dirName}/bin`);
	mkdirSync(outDir, { recursive: true });

	const outfile = join(outDir, binaryName);
	const entrypoint = join(cliDir, "src/index.ts");

	// Build to a temp directory first, then move to dist/. Bun creates a temp
	// file in CWD during compilation and renames it to the outfile. In
	// containerized environments (virtiofs, overlayfs), cross-device renames
	// fail if CWD and outfile are on different filesystem layers. Using /tmp
	// as CWD ensures both paths are on the same native filesystem.
	const tmpOutfile = join("/tmp", `clite-build-${dirName}`, binaryName);
	mkdirSync(join("/tmp", `clite-build-${dirName}`), { recursive: true });

	await $`bun build ${entrypoint} --compile --target ${bunTarget} --outfile ${tmpOutfile} --minify --external @anthropic-ai/vertex-sdk`.cwd(
		"/tmp",
	);
	await $`cp ${tmpOutfile} ${outfile} && chmod 755 ${outfile}`;
	await $`rm -rf ${join("/tmp", `clite-build-${dirName}`)}`;

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
		} catch (e) {
			console.error(`  Smoke test FAILED for ${name}:`, e);
			process.exit(1);
		}
	}

	// Copy plugin sandbox bootstrap if it exists
	const bootstrapSrc = join(
		rootDir,
		"packages/core/dist/extensions/plugin-sandbox-bootstrap.js",
	);
	if (existsSync(bootstrapSrc)) {
		const bootstrapDir = join(cliDir, `dist/${dirName}/extensions`);
		mkdirSync(bootstrapDir, { recursive: true });
		const content = readFileSync(bootstrapSrc);
		await Bun.write(join(bootstrapDir, "plugin-sandbox-bootstrap.js"), content);
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
					clite: `bin/${binaryName}`,
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
