#!/usr/bin/env bun

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const publishVerifyBackupPath = join(
	root,
	".publish-verify-package-json-backup.json",
);
const smokeVersion = "0.0.0-node.smoke";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

type MutablePackageJson = {
	name?: string;
	version?: string;
	private?: boolean;
	main?: string;
	types?: string;
	internal?: boolean;
	exports?: Record<string, unknown>;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

async function runCommand(
	cmd: string[],
	options: { cwd: string; env?: Record<string, string | undefined> },
): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		env: {
			...process.env,
			...options.env,
		},
		stdout: "pipe",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	if (exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} exited with code ${exitCode}`);
	}
	return stdout.trim();
}

async function restorePublishVerifyBackup(): Promise<void> {
	try {
		const raw = await readFile(publishVerifyBackupPath, "utf-8");
		const backups = JSON.parse(raw) as Record<string, string>;
		for (const [filePath, contents] of Object.entries(backups)) {
			await writeFile(filePath, contents);
		}
	} finally {
		await rm(publishVerifyBackupPath, { force: true });
	}
}

function requireLastLine(output: string, label: string): string {
	const lastLine = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.pop();
	if (!lastLine) {
		throw new Error(`Missing ${label} output`);
	}
	return lastLine;
}

async function preparePublishableManifests(): Promise<void> {
	const workspaces = await readdir(packagesDir);
	const packageJsonBackups: Record<string, string> = {};
	const internalPackages = new Set<string>();

	for (const workspace of workspaces) {
		const pkgPath = join(packagesDir, workspace, "package.json");
		try {
			const raw = await readFile(pkgPath, "utf-8");
			packageJsonBackups[pkgPath] = raw;
			const pkg = JSON.parse(raw) as {
				name?: string;
				internal?: boolean;
			};
			if (pkg.internal && typeof pkg.name === "string") {
				internalPackages.add(pkg.name);
			}
		} catch {
			// Skip directories without a package manifest.
		}
	}

	await writeFile(
		publishVerifyBackupPath,
		`${JSON.stringify(packageJsonBackups, null, "\t")}\n`,
	);

	for (const [pkgPath, raw] of Object.entries(packageJsonBackups)) {
		const pkg = JSON.parse(raw) as MutablePackageJson;
		pkg.version = smokeVersion;
		delete pkg.private;

		for (const depType of [
			"dependencies",
			"peerDependencies",
			"optionalDependencies",
		] as const) {
			const deps = pkg[depType];
			if (!deps || typeof deps !== "object") {
				continue;
			}
			for (const [dep, version] of Object.entries(deps)) {
				if (!dep.startsWith("@clinebot/") || version !== "workspace:*") {
					continue;
				}
				if (internalPackages.has(dep)) {
					delete deps[dep];
				} else {
					deps[dep] = smokeVersion;
				}
			}
		}

		if (pkg.name === "@clinebot/core") {
			pkg.main = "./dist/index.node.js";
			pkg.types = "./dist/index.node.d.ts";
			const exportsField = pkg.exports;
			if (
				exportsField &&
				typeof exportsField === "object" &&
				"." in exportsField
			) {
				exportsField["."] = {
					development: "./dist/index.node.js",
					types: "./dist/index.node.d.ts",
					import: "./dist/index.node.js",
				};
			}
		}

		await writeFile(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
}

async function main(): Promise<void> {
	const packDir = await mkdtemp(join(tmpdir(), "cline-node-smoke-packs-"));
	const smokeDir = await mkdtemp(join(tmpdir(), "cline-node-smoke-"));
	const sessionsDir = await mkdtemp(join(tmpdir(), "cline-node-sessions-"));
	const npmCacheDir = await mkdtemp(join(tmpdir(), "cline-node-npm-cache-"));
	const npmEnv = { npm_config_cache: npmCacheDir };

	try {
		await preparePublishableManifests();

		const tarballs = {
			core: requireLastLine(
				await runCommand([npmCommand, "pack", "--pack-destination", packDir], {
					cwd: join(root, "packages/core"),
					env: npmEnv,
				}),
				"core tarball",
			),
			agents: requireLastLine(
				await runCommand([npmCommand, "pack", "--pack-destination", packDir], {
					cwd: join(root, "packages/agents"),
					env: npmEnv,
				}),
				"agents tarball",
			),
			llms: requireLastLine(
				await runCommand([npmCommand, "pack", "--pack-destination", packDir], {
					cwd: join(root, "packages/llms"),
					env: npmEnv,
				}),
				"llms tarball",
			),
			shared: requireLastLine(
				await runCommand([npmCommand, "pack", "--pack-destination", packDir], {
					cwd: join(root, "packages/shared"),
					env: npmEnv,
				}),
				"shared tarball",
			),
		};

		await writeFile(
			join(smokeDir, "package.json"),
			`${JSON.stringify(
				{
					name: "cline-node-smoke",
					private: true,
					type: "module",
					dependencies: {
						"@clinebot/core": `file:${join(packDir, tarballs.core)}`,
						"@clinebot/agents": `file:${join(packDir, tarballs.agents)}`,
						"@clinebot/llms": `file:${join(packDir, tarballs.llms)}`,
						"@clinebot/shared": `file:${join(packDir, tarballs.shared)}`,
					},
				},
				null,
				2,
			)}\n`,
		);

		await runCommand([npmCommand, "install"], {
			cwd: smokeDir,
			env: npmEnv,
		});

		const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
		const smokeSource =
			nodeMajor >= 24
				? `
					const { SqliteSessionStore } = await import("@clinebot/core/node");
					const store = new SqliteSessionStore({ sessionsDir: process.env.CLINE_DATA_DIR });
					store.init();
					console.log("SQLite smoke test passed");
				`
				: `
					const { resolveSessionBackend } = await import("@clinebot/core/node");
					await resolveSessionBackend({ backendMode: "local" });
					console.log("Local backend fallback smoke test passed");
				`;

		await writeFile(
			join(smokeDir, "smoke.mjs"),
			[
				"process.env.CLINE_DATA_DIR = process.env.CLINE_DATA_DIR || '';",
				smokeSource,
			].join("\n"),
		);

		await runCommand(["node", "smoke.mjs"], {
			cwd: smokeDir,
			env: {
				CLINE_DATA_DIR: sessionsDir,
			},
		});
	} finally {
		await restorePublishVerifyBackup().catch(() => {});
		await rm(packDir, { recursive: true, force: true });
		await rm(smokeDir, { recursive: true, force: true });
		await rm(sessionsDir, { recursive: true, force: true });
		await rm(npmCacheDir, { recursive: true, force: true });
	}
}

await main();
