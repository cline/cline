#!/usr/bin/env bun

import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		check: { type: "boolean", default: false },
		dry: { type: "boolean", default: false },
		publish: { type: "boolean", default: false },
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

if (values.check && !values.publish) {
	console.error("--check requires --publish");
	process.exit(1);
}

if (values.check && values.dry) {
	console.error("--check cannot be used with --dry");
	process.exit(1);
}

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const publishVerifyBackupPath = join(
	root,
	".publish-verify-package-json-backup.json",
);

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

async function restorePublishVerifyBackup(): Promise<void> {
	try {
		const raw = await readFile(publishVerifyBackupPath, "utf-8");
		const backups = JSON.parse(raw) as Record<string, string>;
		for (const [filePath, contents] of Object.entries(backups)) {
			await writeFile(filePath, contents);
		}
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			throw error;
		}
	} finally {
		await rm(publishVerifyBackupPath, { force: true });
	}
}

async function runCommandOrThrow(
	cmd: string[],
	options: { cwd: string },
): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`${cmd[0]} exited with code ${exitCode}`);
	}
}

async function runPublishVerification(): Promise<number> {
	const published: { name: string; dir: string; workspace: string }[] = [];

	for (const workspace of workspaces) {
		const pkgPath = join(packagesDir, workspace, "package.json");
		try {
			const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
			if (!pkg.internal) {
				published.push({
					name: pkg.name,
					dir: join(packagesDir, workspace),
					workspace,
				});
			}
		} catch {
			// skip
		}
	}

	if (published.length === 0) {
		console.error("No published packages found");
		return 1;
	}

	console.log(
		`\nFound ${published.length} published package(s): ${published.map((p) => p.name).join(", ")}\n`,
	);

	console.log("--- Checking for leaked workspace:* dependencies ---");
	let hasLeaks = false;

	for (const pkg of published) {
		const raw = JSON.parse(
			await readFile(join(pkg.dir, "package.json"), "utf-8"),
		);
		for (const depType of [
			"dependencies",
			"peerDependencies",
			"optionalDependencies",
		] as const) {
			for (const [dep, ver] of Object.entries(
				(raw[depType] ?? {}) as Record<string, string>,
			)) {
				if (ver === "workspace:*" || ver.startsWith("workspace:")) {
					console.error(
						`  FAIL ${pkg.name} -> ${depType}.${dep} = "${ver}" (workspace protocol not supported by npm)`,
					);
					hasLeaks = true;
				}
			}
		}
	}

	if (hasLeaks) {
		console.error("\nworkspace:* dependencies detected in published packages.");
		return 1;
	}
	console.log("  OK - no workspace protocol leaks\n");

	const testDir = await mkdtemp(join(tmpdir(), "cline-pkg-verify-"));
	const npmCacheDir = join(testDir, ".npm-cache");
	await mkdir(npmCacheDir, { recursive: true });

	function npmEnv() {
		return {
			...process.env,
			npm_config_cache: npmCacheDir,
		};
	}

	async function runCommand(
		cmd: string[],
		options: { cwd: string },
	): Promise<string> {
		const proc = Bun.spawn(cmd, {
			cwd: options.cwd,
			env: npmEnv(),
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		if (exitCode !== 0) {
			throw new Error(
				stderr || stdout || `${cmd[0]} exited with code ${exitCode}`,
			);
		}
		return stdout;
	}

	const tarballs: { name: string; tarball: string }[] = [];

	async function cleanup() {
		await rm(testDir, { recursive: true, force: true });
		for (const t of tarballs) {
			await rm(t.tarball, { force: true });
		}
	}

	let exitCode = 0;

	try {
		console.log("--- Packing tarballs ---");
		for (const pkg of published) {
			const result = await runCommand(
				["npm", "pack", "--pack-destination", root],
				{ cwd: pkg.dir },
			);
			const tarballName = result.trim().split("\n").pop()!;
			const tarball = join(root, tarballName);
			tarballs.push({ name: pkg.name, tarball });
			console.log(`  ${pkg.name} -> ${tarballName}`);
		}

		console.log("\n--- Installing packages in isolated directory ---");
		const testPkg = {
			name: "cline-pkg-verify",
			private: true,
			type: "module",
			dependencies: Object.fromEntries(
				tarballs.map((t) => [t.name, t.tarball]),
			),
		};
		await writeFile(
			join(testDir, "package.json"),
			JSON.stringify(testPkg, null, 2),
		);

		await runCommand(["npm", "install", "--ignore-scripts"], {
			cwd: testDir,
		});
		console.log("  OK - npm install succeeded\n");

		console.log("--- Verifying module resolution ---");
		let importFailed = false;
		for (const pkg of published) {
			const testFile = join(testDir, `test-${pkg.workspace}.ts`);
			await writeFile(
				testFile,
				[
					`try {`,
					`  await import("${pkg.name}");`,
					`  console.log("  OK ${pkg.name}");`,
					`} catch (e: any) {`,
					`  console.error("  FAIL ${pkg.name}:", e.message);`,
					`  if (e.code) console.error("       code:", e.code);`,
					`  process.exitCode = 1;`,
					`}`,
				].join("\n"),
			);
			try {
				const proc = Bun.spawn(["bun", testFile], {
					cwd: testDir,
					stdout: "pipe",
					stderr: "pipe",
				});
				const result = await Promise.race([
					proc.exited,
					new Promise<never>((_, reject) =>
						setTimeout(() => {
							proc.kill();
							reject(new Error("timed out after 30s"));
						}, 30_000),
					),
				]);
				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const output = (stdout + stderr).trim();
				if (output) console.log(output);
				if (result !== 0 || output.includes("FAIL")) {
					importFailed = true;
				}
			} catch (e: unknown) {
				importFailed = true;
				const msg = e instanceof Error ? e.message : String(e);
				console.error(`  FAIL - could not import ${pkg.name}: ${msg}`);
			}
		}

		console.log("\n--- Verifying publish-only package invariants ---");
		for (const pkg of published) {
			if (pkg.name !== "@clinebot/core") {
				continue;
			}

			const testFile = join(testDir, `test-${pkg.workspace}-publish-shape.ts`);
			await writeFile(
				testFile,
				[
					`import { readFileSync } from "node:fs";`,
					`import { join } from "node:path";`,
					`const pkgJson = JSON.parse(readFileSync(join(process.cwd(), "node_modules", "@clinebot", "core", "package.json"), "utf8"));`,
					`try {`,
					`  if (pkgJson.dependencies?.["better-sqlite3"] !== undefined) {`,
					`    console.error("  FAIL @clinebot/core: package.json should not declare better-sqlite3 directly");`,
					`    process.exit(1);`,
					`  }`,
					`  const root = await import("@clinebot/core");`,
					`  const node = await import("@clinebot/core/node");`,
					`  if (typeof root.createSessionHost !== "function") {`,
					`    console.error("  FAIL @clinebot/core: root export is missing createSessionHost");`,
					`    process.exit(1);`,
					`  }`,
					`  if (typeof node.createSessionHost !== "function") {`,
					`    console.error("  FAIL @clinebot/core: ./node export is missing createSessionHost");`,
					`    process.exit(1);`,
					`  }`,
					`} catch (error) {`,
					`  const message = error instanceof Error ? error.message : String(error);`,
					`  console.error("  FAIL @clinebot/core: published runtime shape is invalid:", message);`,
					`  process.exit(1);`,
					`}`,
					`console.log("  OK @clinebot/core publish shape");`,
				].join("\n"),
			);
			try {
				const proc = Bun.spawn(["bun", testFile], {
					cwd: testDir,
					stdout: "pipe",
					stderr: "pipe",
				});
				const result = await Promise.race([
					proc.exited,
					new Promise<never>((_, reject) =>
						setTimeout(() => {
							proc.kill();
							reject(new Error("timed out after 30s"));
						}, 30_000),
					),
				]);
				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const output = (stdout + stderr).trim();
				if (output) console.log(output);
				if (result !== 0 || output.includes("FAIL")) {
					importFailed = true;
				}
			} catch (e: unknown) {
				importFailed = true;
				const msg = e instanceof Error ? e.message : String(e);
				console.error(
					`  FAIL - could not verify publish shape for ${pkg.name}: ${msg}`,
				);
			}
		}

		if (importFailed) {
			console.error("\nSome packages failed to import.");
			exitCode = 1;
		} else {
			console.log("\nAll packages verified successfully.");
		}
	} catch (e: unknown) {
		exitCode = 1;
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`\nVerification failed:\n${msg}`);
	} finally {
		await cleanup();
	}

	return exitCode;
}

// Build a set of internal (bundled-only) package names from their package.json "internal" field.
// When --publish is used, workspace:* deps pointing to internal packages are stripped (they're bundled
// into the build output), while deps pointing to published packages are resolved to the concrete version.
const internalPackages = new Set<string>();
const packageJsonBackups: Record<string, string> = {};
for (const workspace of workspaces) {
	try {
		const pkgPath = join(packagesDir, workspace, "package.json");
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		packageJsonBackups[pkgPath] = raw;
		if (pkg.internal) {
			internalPackages.add(pkg.name);
		}
	} catch {
		// skip
	}
}

let updated = 0;

if (values.publish && !values.dry) {
	await writeFile(
		publishVerifyBackupPath,
		`${JSON.stringify(packageJsonBackups, null, "\t")}\n`,
	);
}

for (const workspace of workspaces) {
	const pkgPath = join(packagesDir, workspace, "package.json");
	try {
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		const oldVersion = pkg.version;
		pkg.version = version;

		if (values.publish) {
			delete pkg.private;
			for (const [dep, ver] of Object.entries(
				(pkg.dependencies ?? {}) as Record<string, string>,
			)) {
				if (dep.startsWith("@clinebot/") && ver === "workspace:*") {
					if (!internalPackages.has(dep)) {
						pkg.dependencies[dep] = version;
					} else {
						delete pkg.dependencies[dep];
					}
				}
			}

			if (pkg.name === "@clinebot/core") {
				pkg.main = "./dist/index.node.js";
				pkg.types = "./dist/index.node.d.ts";
				if (pkg.exports?.["."]) {
					pkg.exports["."] = {
						development: "./dist/index.node.js",
						types: "./dist/index.node.d.ts",
						import: "./dist/index.node.js",
					};
				}
			}
		}

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

if (values.check) {
	const exitCode = await runPublishVerification();
	await restorePublishVerifyBackup();
	process.exit(exitCode);
}

if (!values.dry) {
	await runCommandOrThrow(["bun", "-F", "@clinebot/llms", "generate:models"], {
		cwd: root,
	});
	await runCommandOrThrow(["bun", "format", "--write"], { cwd: root });
}
