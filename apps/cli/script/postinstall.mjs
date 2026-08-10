#!/usr/bin/env node

// Post-install script for Cline CLI.
//
// Creates a hard link (or copy fallback) from the platform-specific binary
// to bin/.cline for fast startup on subsequent runs.
//
// This script must use only Node.js APIs (no Bun) since it runs via
// "node script/postinstall.mjs" in the npm lifecycle.

import childProcess from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// In the published package this script sits at the package root next to
// bin/. In the source tree it lives in script/ with bin/ one level up.
const binDir =
	path.basename(__dirname) === "script"
		? path.join(__dirname, "..", "bin")
		: path.join(__dirname, "bin");

// Verify a candidate binary actually runs. On x64 CPUs without AVX2 the
// default Bun build dies with SIGILL, so this catches a wrong pick even if
// CPU-feature detection was inconclusive. If the binary could not be
// spawned at all (sandboxes that block exec), treat that as inconclusive
// rather than a rejection.
function verifyBinary(binaryPath) {
	try {
		const result = childProcess.spawnSync(binaryPath, ["--version"], {
			stdio: "ignore",
			timeout: 15000,
			windowsHide: true,
		});
		if (result.error) {
			return true;
		}
		return result.status === 0;
	} catch {
		return true;
	}
}

function main() {
	if (os.platform() === "win32") {
		// On Windows, npm creates .cmd shims from the bin field.
		// The resolver script handles binary lookup at runtime.
		console.log("Windows detected: skipping binary cache setup");
		return;
	}

	const platformMap = {
		darwin: "darwin",
		linux: "linux",
	};
	const platform = platformMap[os.platform()] || os.platform();
	const arch = os.arch();
	const binaryName = "cline";

	const baseline = require(path.join(binDir, "baseline.cjs"));
	const packageNames = baseline.resolvePlatformPackageNames(platform, arch);

	const target = path.join(binDir, ".cline");

	for (const packageName of packageNames) {
		let binaryPath;
		try {
			const packageJsonPath = require.resolve(`${packageName}/package.json`);
			const packageDir = path.dirname(packageJsonPath);
			binaryPath = path.join(packageDir, "bin", binaryName);

			if (!fs.existsSync(binaryPath)) {
				throw new Error(`Binary not found at ${binaryPath}`);
			}
		} catch (_error) {
			// Platform package not available; try the next candidate. The
			// resolver script will also search node_modules at runtime.
			continue;
		}

		// Ensure bin directory exists
		if (!fs.existsSync(binDir)) {
			fs.mkdirSync(binDir, { recursive: true });
		}

		// Remove existing cached binary
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

		fs.chmodSync(target, 0o755);

		if (!verifyBinary(target)) {
			console.log(`Note: ${packageName} binary failed to run, trying next`);
			fs.unlinkSync(target);
			continue;
		}

		console.log(`Cached cline binary at ${target}`);
		return;
	}

	console.log(
		`Note: no working platform package found (looked for ${packageNames.join(", ")}), skipping binary cache`,
	);
}

try {
	main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
