#!/usr/bin/env node

// Post-install script for Cline CLI.
//
// Creates a hard link (or copy fallback) from the platform-specific binary
// to bin/.cline for fast startup on subsequent runs.
//
// On x64 Linux without AVX2 (e.g. Sandy Bridge / Xeon E5-2620 v1),
// the standard Bun-compiled binary requires AVX2 and will SIGILL immediately.
// This script detects the CPU capability and caches the -baseline variant when
// AVX2 is absent so the fast-path cached binary is always runnable.
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

// Reuse the pure helpers from bin/resolver-helpers.cjs so the package-selection
// logic is shared and testable without duplicating the AVX2 detection regex.
const { cpuHasAvx2, choosePackageName } = require(
	path.join(__dirname, "..", "bin", "resolver-helpers.cjs"),
);

// Reads /proc/cpuinfo on Linux to detect AVX2 support. Returns true on non-Linux platforms.
function hostCpuHasAvx2() {
	if (os.platform() !== "linux") {
		return true; // /proc/cpuinfo is only reliable on Linux; assume capable elsewhere.
	}
	try {
		const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
		return cpuHasAvx2(cpuinfo);
	} catch (_) {
		return true; // If unreadable, conservatively assume capable.
	}
}

function main() {
	if (os.platform() === "win32") {
		// On Windows, npm creates .cmd shims from the bin field.
		// The resolver script handles binary lookup at runtime.
		console.log("Windows detected: skipping binary cache setup");
		return;
	}

	const arch = os.arch();
	const hasAvx2 = hostCpuHasAvx2();

	// choosePackageName picks the -baseline variant when arch=x64 and !hasAvx2.
	// Returns null for unsupported platforms (e.g. win32 is already handled above).
	const packageName = choosePackageName(os.platform(), arch, hasAvx2);
	if (!packageName) {
		console.log(
			`Note: platform ${os.platform()} not supported, skipping binary cache`,
		);
		return;
	}

	const binaryName = "cline";

	let binaryPath;
	try {
		const packageJsonPath = require.resolve(`${packageName}/package.json`);
		const packageDir = path.dirname(packageJsonPath);
		binaryPath = path.join(packageDir, "bin", binaryName);

		if (!fs.existsSync(binaryPath)) {
			throw new Error(`Binary not found at ${binaryPath}`);
		}
	} catch (_error) {
		// Platform package not available. On a no-AVX2 host this means the baseline
		// package is missing — do NOT fall back to caching the standard (AVX2) binary
		// because that would SIGILL at runtime. Instead skip caching entirely so the
		// runtime resolver's node_modules walk (which prefers baseline) handles it.
		const reason = !hasAvx2 && arch === "x64" ? "baseline " : "";
		console.log(
			`Note: ${reason}${packageName} not found, skipping binary cache`,
		);
		return;
	}

	const binDir =
		path.basename(__dirname) === "script"
			? path.join(__dirname, "..", "bin")
			: path.join(__dirname, "bin");
	const target = path.join(binDir, ".cline");

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
	console.log(`Cached cline binary at ${target}`);
}

try {
	main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
