/** Compile the broker and Gateway into target-named Tauri sidecars. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const appRoot = join(import.meta.dirname, "..");
const repoRoot = join(appRoot, "..", "..");
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

const brokerOutfile = join(outDir, `gateway-desktop-broker-${triple}`);
const gatewayOutfile = join(outDir, `cline-gateway-${triple}`);

await $`bun build ${join(appRoot, "native", "index.ts")} --compile --outfile ${brokerOutfile}`.cwd(
	appRoot,
);
await $`bun build ${join(repoRoot, "sdk", "packages", "gateway", "bin", "cline-gateway.mjs")} --compile --outfile ${gatewayOutfile}`.cwd(
	repoRoot,
);

// Bun-compiled Mach-O files need their ad-hoc signature to run during
// `tauri dev`. Production packaging explicitly requests unsigned sidecars so
// Tauri can apply the final Developer ID signature inside the app bundle.
if (
	process.platform === "darwin" &&
	process.env.GATEWAY_DESKTOP_PREPARE_SIGNING === "1"
) {
	await $`codesign --remove-signature ${brokerOutfile}`;
	await $`codesign --remove-signature ${gatewayOutfile}`;
}

console.log(`broker sidecar written to ${brokerOutfile}`);
console.log(`Gateway sidecar written to ${gatewayOutfile}`);
