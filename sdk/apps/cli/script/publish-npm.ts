#!/usr/bin/env bun

// Publishes cline and all platform-specific binary packages to npm.
//
// Usage:
//   bun script/publish-npm.ts                 # publish with "latest" tag
//   bun script/publish-npm.ts --tag next     # publish with "next" tag
//   bun script/publish-npm.ts --dry-run      # preview without publishing
//
// Prerequisites:
//   - Run script/build.ts first to generate dist/ packages
//   - GitHub trusted publishing or `npm login` for authentication

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";

const cliDir = join(import.meta.dir, "..");
process.chdir(cliDir);

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		"dry-run": { type: "boolean", default: false },
		tag: { type: "string", default: "latest" },
	},
	strict: true,
});

const dryRun = values["dry-run"] ?? false;
const npmTag = values.tag ?? "latest";
const wrapperPackageName = "cline";

const expectedPlatformPackages = [
	"@cline/cli-darwin-arm64",
	"@cline/cli-darwin-x64",
	"@cline/cli-linux-arm64",
	"@cline/cli-linux-x64",
	"@cline/cli-windows-arm64",
	"@cline/cli-windows-x64",
] as const;

interface PlatformPackageManifest {
	name: string;
	version: string;
	os: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isPlatformPackageManifest(
	value: unknown,
): value is PlatformPackageManifest {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.version === "string" &&
		isStringArray(value.os)
	);
}

function removePackedTarballs(dir: string): void {
	for (const entry of readdirSync(dir)) {
		if (entry.endsWith(".tgz")) {
			rmSync(join(dir, entry), { force: true });
		}
	}
}

async function npmPackageVersionExists(
	name: string,
	version: string,
): Promise<boolean> {
	const result = Bun.spawnSync(
		["npm", "view", `${name}@${version}`, "version"],
		{
			cwd: cliDir,
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	return result.exitCode === 0;
}

async function publishPackage(input: {
	name: string;
	version: string;
	dir: string;
	tag: string;
	dryRun: boolean;
}): Promise<void> {
	if (process.platform !== "win32") {
		await $`chmod -R 755 .`.cwd(input.dir);
	}

	if (input.dryRun) {
		console.log(`  [dry-run] Would publish ${input.name}@${input.version}`);
		return;
	}

	if (await npmPackageVersionExists(input.name, input.version)) {
		console.log(`  ${input.name}@${input.version} already exists, skipping`);
		return;
	}

	console.log(`  Publishing ${input.name}@${input.version}...`);
	removePackedTarballs(input.dir);
	await $`bun pm pack`.cwd(input.dir);
	await $`npm publish *.tgz --access public --tag ${input.tag}`.cwd(input.dir);
	console.log(`  Published ${input.name}@${input.version}`);
}

// Discover built platform packages from dist/
const binaries: Record<string, string> = {};
for await (const filepath of new Bun.Glob("*/package.json").scan({
	cwd: join(cliDir, "dist"),
})) {
	const pkg: unknown = JSON.parse(
		readFileSync(join(cliDir, "dist", filepath), "utf-8"),
	);
	if (isPlatformPackageManifest(pkg)) {
		binaries[pkg.name] = pkg.version;
	}
}

if (Object.keys(binaries).length === 0) {
	console.error("No platform packages found in dist/.");
	console.error("Run `bun script/build.ts` first.");
	process.exit(1);
}

const missingPackages = expectedPlatformPackages.filter(
	(name) => !(name in binaries),
);
if (missingPackages.length > 0) {
	console.error("Missing platform packages in dist/:");
	for (const name of missingPackages) {
		console.error(`  ${name}`);
	}
	process.exit(1);
}

const versions = new Set(Object.values(binaries));
if (versions.size !== 1) {
	console.error("Platform package versions do not match:");
	for (const [name, packageVersion] of Object.entries(binaries).sort()) {
		console.error(`  ${name}@${packageVersion}`);
	}
	process.exit(1);
}

const version = Object.values(binaries)[0];
const sourcePkg: unknown = JSON.parse(
	readFileSync(join(cliDir, "package.json"), "utf-8"),
);
const sourcePkgRecord = isRecord(sourcePkg) ? sourcePkg : {};
const sourceVersion =
	"version" in sourcePkgRecord && typeof sourcePkgRecord.version === "string"
		? sourcePkgRecord.version
		: undefined;
if (sourceVersion !== version) {
	console.error(
		`Built package version ${version} does not match apps/cli/package.json version ${sourceVersion ?? "(missing)"}.`,
	);
	process.exit(1);
}
const sourceRepository =
	"repository" in sourcePkgRecord ? sourcePkgRecord.repository : undefined;

console.log(`Publishing ${wrapperPackageName} v${version}`);
console.log(`  Tag: ${npmTag}`);
console.log(`  Dry run: ${dryRun}`);
console.log(`  Platform packages: ${Object.keys(binaries).length}`);
for (const name of Object.keys(binaries)) {
	console.log(`    ${name}`);
}

// Step 1: Publish platform-specific packages (in parallel)
console.log("\nPublishing platform packages...");
const platformTasks = Object.keys(binaries)
	.sort()
	.map(async (name) => {
		const dirName = name.replace("@cline/", "");
		const pkgDir = join(cliDir, "dist", dirName);

		await publishPackage({
			name,
			version,
			dir: pkgDir,
			tag: npmTag,
			dryRun,
		});
	});
await Promise.all(platformTasks);

// Step 2: Generate and publish the main wrapper package
console.log("\nPreparing main package...");
const mainPkgDir = join(cliDir, "dist", "cli");

await $`rm -rf ${mainPkgDir}`;
await $`mkdir -p ${mainPkgDir}`;
await $`cp -r ${join(cliDir, "bin")} ${join(mainPkgDir, "bin")}`;
await $`cp ${join(cliDir, "script/postinstall.mjs")} ${join(mainPkgDir, "postinstall.mjs")}`;

// Copy LICENSE from repo root if it exists
const licenseFrom = join(cliDir, "../../LICENSE");
if (existsSync(licenseFrom)) {
	await $`cp ${licenseFrom} ${join(mainPkgDir, "LICENSE")}`;
}

const mainPkg: unknown = JSON.parse(
	readFileSync(join(cliDir, "package.json"), "utf-8"),
);
const mainPkgRecord = isRecord(mainPkg) ? mainPkg : {};
const description =
	"description" in mainPkgRecord &&
	typeof mainPkgRecord.description === "string"
		? mainPkgRecord.description
		: undefined;
const license =
	"license" in mainPkgRecord && typeof mainPkgRecord.license === "string"
		? mainPkgRecord.license
		: undefined;
const wrapperPackageJson = {
	name: wrapperPackageName,
	version,
	description: description || "Cline CLI",
	license: license || "Apache-2.0",
	...(sourceRepository ? { repository: sourceRepository } : {}),
	bin: {
		cline: "./bin/cline",
	},
	scripts: {
		postinstall: "node ./postinstall.mjs || true",
	},
	optionalDependencies: binaries,
};

await Bun.write(
	join(mainPkgDir, "package.json"),
	`${JSON.stringify(wrapperPackageJson, null, 2)}\n`,
);

if (dryRun) {
	console.log(
		`  [dry-run] Would publish ${wrapperPackageName}@${version} with tag ${npmTag}`,
	);
	console.log("\nDry run complete. No packages were published.");
} else {
	await publishPackage({
		name: wrapperPackageName,
		version,
		dir: mainPkgDir,
		tag: npmTag,
		dryRun: false,
	});
	console.log(
		`\nPublished ${wrapperPackageName}@${version} with tag ${npmTag}`,
	);

	console.log("\nInstall with:");
	console.log(`  npm install -g ${wrapperPackageName}`);
}
