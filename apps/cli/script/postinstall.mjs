#!/usr/bin/env node

// Post-install script for Cline CLI.
//
// Ensures the platform-specific compiled binary is available:
// 1. If the platform package installed normally (optionalDependencies),
//    creates a hard link (or copy fallback) at bin/.cline (bin/.cline.exe on
//    Windows) for fast startup.
// 2. If the platform package is missing (npm silently skips optional
//    dependencies that fail to download or extract), downloads the package
//    tarball directly from the npm registry and caches the binary.
//
// This script must use only Node.js APIs (no Bun) since it runs via
// "node script/postinstall.mjs" in the npm lifecycle.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Published wrapper layout: postinstall.mjs at the package root with bin/
// next to it. Dev layout: this file lives in script/ with bin/ a level up.
const packageRoot =
	path.basename(__dirname) === "script"
		? path.join(__dirname, "..")
		: __dirname;
const binDir = path.join(packageRoot, "bin");
const binaryInstall = require(path.join(binDir, "binary-install.cjs"));

function readOwnPackageJson() {
	try {
		return JSON.parse(
			fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
		);
	} catch {
		return undefined;
	}
}

function cacheBinary(binaryPath, target) {
	if (!fs.existsSync(binDir)) {
		fs.mkdirSync(binDir, { recursive: true });
	}
	if (fs.existsSync(target)) {
		fs.unlinkSync(target);
	}
	// Hard link preferred (shares disk space), copy as fallback
	// (hard links fail on some filesystems like NFS or cross-device)
	try {
		fs.linkSync(binaryPath, target);
	} catch {
		fs.copyFileSync(binaryPath, target);
	}
	try {
		fs.chmodSync(target, 0o755);
	} catch {
		// Windows has no chmod semantics.
	}
	console.log(`Cached cline binary at ${target}`);
}

async function main() {
	const target = binaryInstall.getPlatformTarget(os.platform(), os.arch());
	if (!target) {
		console.log(
			`Note: no prebuilt cline binary for ${os.platform()} ${os.arch()}`,
		);
		return;
	}

	const cachePath = path.join(binDir, target.cacheName);

	let binaryPath;
	try {
		const packageJsonPath = require.resolve(
			`${target.packageName}/package.json`,
		);
		binaryPath = path.join(
			path.dirname(packageJsonPath),
			"bin",
			target.binaryName,
		);
		if (!fs.existsSync(binaryPath)) {
			binaryPath = undefined;
		}
	} catch {
		binaryPath = undefined;
	}

	if (binaryPath) {
		cacheBinary(binaryPath, cachePath);
		return;
	}

	// Platform package missing: npm skipped the optional dependency (failed
	// download, omit=optional, antivirus, registry mirror lag). Fall back to
	// downloading the tarball directly from the registry.
	const pkg = readOwnPackageJson();
	const version =
		pkg?.optionalDependencies?.[target.packageName] || pkg?.version;
	if (!version) {
		console.log(`Note: ${target.packageName} not found, skipping binary cache`);
		return;
	}

	console.log(
		`${target.packageName} was not installed by npm; ` +
			`downloading v${version} directly from the registry...`,
	);
	try {
		await binaryInstall.installBinaryFromRegistry({
			packageName: target.packageName,
			version,
			binaryName: target.binaryName,
			destPath: cachePath,
			env: process.env,
		});
		console.log(`Cached cline binary at ${cachePath}`);
	} catch (error) {
		console.warn(`Download fallback failed: ${error.message}`);
		console.warn(binaryInstall.missingBinaryHelp(target.packageName));
	}
}

try {
	await main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
