#!/usr/bin/env node

// Post-install script for Cline CLI.
//
// Creates a hard link (or copy fallback) from the platform-specific binary
// to bin/.cline for fast startup on subsequent runs.
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

// CLI versions <= 3.0.54 restart the hub daemon after a background
// auto-update even while it is serving live sessions, killing those sessions
// mid-turn — and their build-fingerprint check then rejects every replacement
// hub, bricking the running TUI. That restart code is the *old* version's, so
// it cannot be patched here; but it bails out harmlessly when no hub
// discovery record exists, and it runs only after this install (and this
// script) completes. Setting the record aside protects any attached clients:
// a running hub keeps serving its established connections, clients that share
// its build fingerprint rebuild the record from a port probe, and the next
// fresh launch retires stale hubs regardless of the record.
function shieldRunningHubDiscovery() {
	const explicitPath = process.env.CLINE_HUB_DISCOVERY_PATH?.trim();
	const dataDir =
		process.env.CLINE_DATA_DIR?.trim() ||
		path.join(
			process.env.CLINE_DIR?.trim() || path.join(os.homedir(), ".cline"),
			"data",
		);
	const recordPath =
		explicitPath || path.join(dataDir, "locks", "hub", "production.json");
	if (!fs.existsSync(recordPath)) {
		return;
	}
	const asidePath = `${recordPath}.superseded`;
	fs.rmSync(asidePath, { force: true });
	fs.renameSync(recordPath, asidePath);
	console.log("Set aside hub discovery record for the updated CLI");
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
	const packageName = `@cline/cli-${platform}-${arch}`;
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
	shieldRunningHubDiscovery();
} catch (error) {
	// Best-effort: without the shield the worst case is the pre-3.0.55
	// restart-while-busy behavior, never a broken install.
	console.error(`postinstall: hub discovery shield skipped: ${error.message}`);
}

try {
	main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
