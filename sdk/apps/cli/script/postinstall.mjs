#!/usr/bin/env node

// Post-install script for @clinebot/cli.
//
// Creates a hard link (or copy fallback) from the platform-specific binary
// to bin/.clite for fast startup on subsequent runs.
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
	const packageName = `@clinebot/cli-${platform}-${arch}`;
	const binaryName = "clite";

	let binaryPath;
	try {
		const packageJsonPath = require.resolve(`${packageName}/package.json`);
		const packageDir = path.dirname(packageJsonPath);
		binaryPath = path.join(packageDir, "bin", binaryName);

		if (!fs.existsSync(binaryPath)) {
			throw new Error(`Binary not found at ${binaryPath}`);
		}
	} catch (_error) {
		// Platform package not available. The resolver script will find
		// it at runtime by walking node_modules. This is expected on
		// platforms we don't ship binaries for.
		console.log(`Note: ${packageName} not found, skipping binary cache`);
		return;
	}

	const binDir =
		path.basename(__dirname) === "script"
			? path.join(__dirname, "..", "bin")
			: path.join(__dirname, "bin");
	const target = path.join(binDir, ".clite");

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
	console.log(`Cached clite binary at ${target}`);
}

try {
	main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
