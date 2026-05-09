#!/usr/bin/env bun

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		dry: { type: "boolean", default: false },
	},
	allowPositionals: true,
	strict: true,
});

let version = positionals[0];

function incrementPatchVersion(input: string): string {
	const match = input.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/);
	if (!match) {
		throw new Error(`Invalid semver version: ${input}`);
	}

	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number(patch) + 1}`;
}

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const dirs = await readdir(packagesDir, { withFileTypes: true });
const workspaces = dirs.filter((d) => d.isDirectory()).map((d) => d.name);

if (!version) {
	for (const workspace of workspaces) {
		const pkgPath = join(packagesDir, workspace, "package.json");
		try {
			const raw = await readFile(pkgPath, "utf-8");
			const pkg = JSON.parse(raw);
			if (typeof pkg.version === "string") {
				version = incrementPatchVersion(pkg.version);
				break;
			}
		} catch {
			// skip directories without a package.json
		}
	}

	if (!version) {
		console.error(
			"Could not determine a current version from workspace package.json files.",
		);
		process.exit(1);
	}
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Invalid semver version: ${version}`);
	process.exit(1);
}

if (positionals[0] === undefined) {
	console.log(`No version provided, defaulting to next patch: ${version}`);
}

async function runCommandOrThrow(cmd: string[], cwd: string): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`${cmd[0]} exited with code ${exitCode}`);
	}
}

let updated = 0;

for (const workspace of workspaces) {
	const pkgPath = join(packagesDir, workspace, "package.json");
	try {
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		if (pkg.internal === true) {
			continue;
		}
		const oldVersion = pkg.version;
		pkg.version = version;

		const out = `${JSON.stringify(pkg, null, "\t")}\n`;

		if (values.dry) {
			console.log(`[dry] ${pkg.name}: ${oldVersion} → ${version}`);
		} else {
			await writeFile(pkgPath, out);
			console.log(`${pkg.name}: ${oldVersion} → ${version}`);
		}
		updated++;
	} catch {
		// skip directories without a package.json
	}
}

console.log(
	`\n${values.dry ? "[dry] " : ""}Updated ${updated} package(s) to v${version}`,
);

if (!values.dry) {
	const lockPath = join(root, "bun.lock");
	await rm(lockPath, { force: true });
	console.log("Removed stale bun.lock if present");
	await runCommandOrThrow(["bun", "install", "--lockfile-only"], root);
	await runCommandOrThrow(
		["bun", "-F", "@clinebot/llms", "generate:models"],
		root,
	);
	await runCommandOrThrow(["bun", "format", "--write"], root);
	await runCommandOrThrow(["bun", "run", "build"], root);
}
