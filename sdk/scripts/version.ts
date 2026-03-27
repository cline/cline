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

type PackageInfo = {
	name: string;
	dir: string;
	workspace: string;
};

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		check: { type: "boolean", default: false },
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

if (values.check && values.dry) {
	console.error("--check cannot be used with --dry");
	process.exit(1);
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

async function runCommandOrThrow(
	cmd: string[],
	options: {
		cwd: string;
		env?: Record<string, string | undefined>;
		stdout?: "inherit" | "pipe";
		stderr?: "inherit" | "pipe";
	},
): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		env: options.env,
		stdout: options.stdout ?? "inherit",
		stderr: options.stderr ?? "inherit",
	});
	const exitCode = await proc.exited;
	const stdout =
		options.stdout === "pipe" && proc.stdout
			? await new Response(proc.stdout).text()
			: "";
	const stderr =
		options.stderr === "pipe" && proc.stderr
			? await new Response(proc.stderr).text()
			: "";
	if (exitCode !== 0) {
		throw new Error(
			stderr.trim() || stdout.trim() || `${cmd[0]} exited with code ${exitCode}`,
		);
	}
	return stdout;
}

async function listPublishedPackages(): Promise<PackageInfo[]> {
	const published: PackageInfo[] = [];

	for (const workspace of workspaces) {
		const pkgPath = join(packagesDir, workspace, "package.json");
		try {
			const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
			if (!pkg.internal && typeof pkg.name === "string") {
				published.push({
					name: pkg.name,
					dir: join(packagesDir, workspace),
					workspace,
				});
			}
		} catch {
			// skip directories without a package manifest
		}
	}

	return published;
}

async function packWorkspacePackage(
	pkg: PackageInfo,
	packRoot: string,
): Promise<string> {
	const destination = await mkdtemp(join(packRoot, `${pkg.workspace}-`));
	await runCommandOrThrow(
		["bun", "pm", "pack", "--destination", destination],
		{ cwd: pkg.dir },
	);
	const files = (await readdir(destination)).filter((file) =>
		file.endsWith(".tgz"),
	);
	if (files.length !== 1) {
		throw new Error(
			`Expected one tarball for ${pkg.name}, found ${files.length} in ${destination}`,
		);
	}
	return join(destination, files[0]);
}

async function runPublishVerification(): Promise<number> {
	const published = await listPublishedPackages();
	if (published.length === 0) {
		console.error("No published packages found");
		return 1;
	}

	console.log(
		`\nFound ${published.length} published package(s): ${published.map((pkg) => pkg.name).join(", ")}\n`,
	);

	const testDir = await mkdtemp(join(tmpdir(), "cline-pkg-verify-"));
	const packDir = await mkdtemp(join(tmpdir(), "cline-pkg-packs-"));
	const npmCacheDir = join(testDir, ".npm-cache");
	await mkdir(npmCacheDir, { recursive: true });

	const tarballs: { name: string; tarball: string }[] = [];

	const npmEnv = {
		...process.env,
		npm_config_cache: npmCacheDir,
	};

	let exitCode = 0;

	try {
		console.log("--- Packing tarballs with Bun ---");
		for (const pkg of published) {
			const tarball = await packWorkspacePackage(pkg, packDir);
			tarballs.push({ name: pkg.name, tarball });
			console.log(`  ${pkg.name} -> ${tarball.split("/").pop()}`);
		}

		console.log("\n--- Installing packages in isolated directory ---");
		const testPkg = {
			name: "cline-pkg-verify",
			private: true,
			type: "module",
			dependencies: Object.fromEntries(
				tarballs.map((entry) => [entry.name, entry.tarball]),
			),
		};
		await writeFile(
			join(testDir, "package.json"),
			JSON.stringify(testPkg, null, 2),
		);

		await runCommandOrThrow(["npm", "install", "--ignore-scripts"], {
			cwd: testDir,
			env: npmEnv,
			stdout: "pipe",
			stderr: "pipe",
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
			} catch (error: unknown) {
				importFailed = true;
				const message = error instanceof Error ? error.message : String(error);
				console.error(`  FAIL - could not import ${pkg.name}: ${message}`);
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
			} catch (error: unknown) {
				importFailed = true;
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					`  FAIL - could not verify publish shape for ${pkg.name}: ${message}`,
				);
			}
		}

		if (importFailed) {
			console.error("\nSome packages failed to import.");
			exitCode = 1;
		} else {
			console.log("\nAll packages verified successfully.");
		}
	} catch (error: unknown) {
		exitCode = 1;
		const message = error instanceof Error ? error.message : String(error);
		console.error(`\nVerification failed:\n${message}`);
	} finally {
		await rm(testDir, { recursive: true, force: true });
		await rm(packDir, { recursive: true, force: true });
	}

	return exitCode;
}

let updated = 0;

for (const workspace of workspaces) {
	const pkgPath = join(packagesDir, workspace, "package.json");
	try {
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
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

if (values.check) {
	const exitCode = await runPublishVerification();
	process.exit(exitCode);
}

if (!values.dry) {
	await runCommandOrThrow(["bun", "-F", "@clinebot/llms", "generate:models"], {
		cwd: root,
	});
	await runCommandOrThrow(["bun", "format", "--write"], { cwd: root });
}
