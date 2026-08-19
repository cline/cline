#!/usr/bin/env bun

/**
 * Cross-platform `clean` for the SDK monorepo.
 *
 * Deletes `dist` and `node_modules` from every workspace listed in the root
 * package.json, plus the repo root itself. Runs serially to avoid races between
 * sibling workspaces whose `node_modules` are wired together via symlinks /
 * junctions on Windows.
 *
 */

import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";

type RootPackageJson = {
	workspaces?: string[];
};

const TARGETS = ["dist", "node_modules"] as const;

const root = path.join(import.meta.dir, "..", "..");

async function readWorkspaceGlobs(): Promise<string[]> {
	const raw = await readFile(path.join(root, "package.json"), "utf8");
	const pkg = JSON.parse(raw) as RootPackageJson;
	return pkg.workspaces ?? [];
}

async function expandWorkspaces(globs: string[]): Promise<string[]> {
	const dirs = new Set<string>();

	for (const pattern of globs) {
		// Bun.Glob expects forward slashes. The workspaces field already uses
		// them, but normalize defensively.
		const normalized = pattern.replaceAll("\\", "/");
		const glob = new Glob(normalized);

		for await (const match of glob.scan({
			cwd: root,
			onlyFiles: false,
			absolute: false,
		})) {
			const absolute = path.join(root, match);
			let isDir = false;
			try {
				const info = await stat(absolute);
				isDir = info.isDirectory();
			} catch {
				continue;
			}
			if (isDir) {
				dirs.add(absolute);
			}
		}
	}

	return [...dirs].sort();
}

async function removeTargetsIn(dir: string): Promise<void> {
	for (const target of TARGETS) {
		const targetPath = path.join(dir, target);
		try {
			await rm(targetPath, { recursive: true, force: true });
			console.log(`  removed ${path.relative(root, targetPath) || target}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`  skipped ${path.relative(root, targetPath) || target}: ${message}`,
			);
		}
	}
}

async function main(): Promise<void> {
	const globs = await readWorkspaceGlobs();
	const workspaceDirs = await expandWorkspaces(globs);

	// Always include the repo root last so its node_modules (which hosts the
	// hoisted binaries that just ran) is removed after every workspace is done.
	const allDirs = [...workspaceDirs, root];

	for (const dir of allDirs) {
		console.log(`cleaning ${path.relative(root, dir) || "."}`);
		await removeTargetsIn(dir);
	}
}

await main();
