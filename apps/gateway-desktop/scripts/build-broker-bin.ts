/**
 * Compile the broker into a standalone sidecar binary for Tauri
 * bundling: src-tauri/bin/gateway-desktop-broker-<target-triple>.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const appRoot = join(import.meta.dirname, "..");
const outDir = join(appRoot, "src-tauri", "bin");
mkdirSync(outDir, { recursive: true });

const triple =
	process.env.GATEWAY_DESKTOP_TARGET_TRIPLE ??
	(await $`rustc -vV`.text())
		.split("\n")
		.find((line) => line.startsWith("host:"))
		?.slice("host:".length)
		.trim();

if (!triple) {
	throw new Error("cannot determine the target triple (is rustc installed?)");
}

const outfile = join(outDir, `gateway-desktop-broker-${triple}`);
await $`bun build ${join(appRoot, "native", "index.ts")} --compile --outfile ${outfile}`.cwd(
	appRoot,
);
console.log(`broker sidecar written to ${outfile}`);
