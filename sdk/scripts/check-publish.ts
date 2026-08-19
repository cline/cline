#!/usr/bin/env bun

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PackageInfo = {
	name: string;
	dir: string;
	workspace: string;
};

type PackedManifest = {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	exports?: unknown;
};

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");

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
			stderr.trim() ||
				stdout.trim() ||
				`${cmd[0]} exited with code ${exitCode}`,
		);
	}
	return stdout;
}

async function listPublishedPackages(): Promise<PackageInfo[]> {
	const dirs = await readdir(packagesDir, { withFileTypes: true });
	const workspaces = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
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
	await runCommandOrThrow(["bun", "pm", "pack", "--destination", destination], {
		cwd: pkg.dir,
	});
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

async function readPackedPackageJson(tarball: string): Promise<PackedManifest> {
	const raw = await runCommandOrThrow(
		["tar", "-xOf", tarball, "package/package.json"],
		{
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	return JSON.parse(raw) as PackedManifest;
}

function containsDevelopmentExportCondition(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return value.some(containsDevelopmentExportCondition);
	}
	if (Object.hasOwn(value, "development")) {
		return true;
	}
	return Object.values(value).some(containsDevelopmentExportCondition);
}

async function main(): Promise<number> {
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
	const bunCacheDir = await mkdtemp(join(tmpdir(), "cline-pkg-bun-cache-"));
	const tarballs: { name: string; tarball: string }[] = [];
	const packedManifests = new Map<string, PackedManifest>();

	let exitCode = 0;

	try {
		console.log("--- Packing tarballs with Bun ---");
		for (const pkg of published) {
			const tarball = await packWorkspacePackage(pkg, packDir);
			tarballs.push({ name: pkg.name, tarball });
			packedManifests.set(pkg.name, await readPackedPackageJson(tarball));
			console.log(`  ${pkg.name} -> ${tarball.split("/").pop()}`);
		}

		console.log("\n--- Verifying packed manifest versions ---");
		let manifestFailed = false;
		for (const [pkgName, manifest] of packedManifests.entries()) {
			for (const [depName, depVersion] of Object.entries(
				manifest.dependencies ?? {},
			)) {
				const packedDep = packedManifests.get(depName);
				if (!packedDep) {
					continue;
				}
				if (depVersion !== packedDep.version) {
					console.error(
						`  FAIL ${pkgName}: dependencies.${depName} = "${depVersion}" but packed ${depName} version is "${packedDep.version}"`,
					);
					manifestFailed = true;
				}
			}
		}
		if (manifestFailed) {
			console.info(
				"\nPacked manifest dependency versions are not aligned. Please ensure that all workspace dependencies are declared with exact versions that match the packed versions.\n",
			);
			console.info(
				"Try running `bun scripts/version.ts <version>` to update package manifests and regenerate lockfile entries with exact versions for workspace dependencies, before running this script again.",
			);
			return 1;
		}
		console.log("  OK - packed workspace dependency versions are aligned\n");

		console.log("\n--- Verifying packed export maps ---");
		let exportMapFailed = false;
		for (const [pkgName, manifest] of packedManifests.entries()) {
			if (containsDevelopmentExportCondition(manifest.exports)) {
				console.error(
					`  FAIL ${pkgName}: packed package exports include a "development" condition`,
				);
				exportMapFailed = true;
			}
		}
		if (exportMapFailed) {
			console.info(
				"\nPublished packages must resolve to built dist files even when consumers enable custom development conditions.\n",
			);
			return 1;
		}
		console.log(
			"  OK - packed export maps do not include development conditions\n",
		);

		console.log("\n--- Installing packages in isolated directory ---");
		const tarballDependencies = Object.fromEntries(
			tarballs.map((entry) => [entry.name, `file:${entry.tarball}`]),
		);
		const testPkg = {
			name: "cline-pkg-verify",
			private: true,
			type: "module",
			dependencies: tarballDependencies,
			overrides: tarballDependencies,
		};
		await writeFile(
			join(testDir, "package.json"),
			JSON.stringify(testPkg, null, 2),
		);

		await runCommandOrThrow(["bun", "install", "--ignore-scripts"], {
			cwd: testDir,
			env: {
				...process.env,
				BUN_INSTALL_CACHE_DIR: bunCacheDir,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		console.log("  OK - bun install succeeded\n");

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
			if (pkg.name !== "@cline/core") {
				continue;
			}

			const testFile = join(testDir, `test-${pkg.workspace}-publish-shape.ts`);
			await writeFile(
				testFile,
				[
					`import { readFileSync } from "node:fs";`,
					`import { join } from "node:path";`,
					`try {`,
					`  const root = await import("@cline/core");`,
					`  if (typeof root.ClineCore?.create !== "function") {`,
					`    console.error("  FAIL @cline/core: root export is missing ClineCore.create");`,
					`    process.exit(1);`,
					`  }`,
					`} catch (error) {`,
					`  const message = error instanceof Error ? error.message : String(error);`,
					`  console.error("  FAIL @cline/core: published runtime shape is invalid:", message);`,
					`  process.exit(1);`,
					`}`,
					`console.log("  OK @cline/core publish shape");`,
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
		await rm(bunCacheDir, { recursive: true, force: true });
	}

	return exitCode;
}

process.exit(await main());
