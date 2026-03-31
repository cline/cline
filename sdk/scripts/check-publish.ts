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
};

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
	const npmCacheDir = await mkdtemp(join(tmpdir(), "cline-pkg-npm-cache-"));
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
				"Try running `rm bun.lock && bun install --lockfile-only` to regenerate lockfile entries with exact versions for workspace dependencies, before running this script again.",
			);
			return 1;
		}
		console.log("  OK - packed workspace dependency versions are aligned\n");

		console.log("\n--- Installing packages in isolated directory ---");
		const testPkg = {
			name: "cline-pkg-verify",
			private: true,
			type: "module",
			dependencies: Object.fromEntries(
				tarballs.map((entry) => [entry.name, `file:${entry.tarball}`]),
			),
		};
		await writeFile(
			join(testDir, "package.json"),
			JSON.stringify(testPkg, null, 2),
		);

		await runCommandOrThrow([npmCommand, "install", "--ignore-scripts"], {
			cwd: testDir,
			env: {
				...process.env,
				npm_config_cache: npmCacheDir,
			},
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
					`  const node = await import("@clinebot/core");`,
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
		await rm(npmCacheDir, { recursive: true, force: true });
	}

	return exitCode;
}

process.exit(await main());
