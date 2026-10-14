// Collect the exact platform executables after signing, with release-pinned metadata.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const UNIX_RELEASE_TARGETS = [
	{ directory: "cli-darwin-arm64", target: "aarch64-apple-darwin" },
	{ directory: "cli-darwin-x64", target: "x86_64-apple-darwin" },
	{ directory: "cli-linux-arm64", target: "aarch64-unknown-linux-gnu" },
	{ directory: "cli-linux-x64", target: "x86_64-unknown-linux-gnu" },
] as const;

export function collectReleaseAssets(
	dist: string,
	output: string,
	identity: { buildId: string; buildEpochMs?: number },
): void {
	if (
		!identity.buildId.trim() ||
		!Number.isSafeInteger(identity.buildEpochMs) ||
		(identity.buildEpochMs ?? 0) <= 0
	)
		throw new Error("Missing runtime SDK build identity or build epoch");
	mkdirSync(output, { recursive: true });
	for (const { directory, target } of UNIX_RELEASE_TARGETS) {
		const name = `cline-runtime-${target}`;
		const destination = join(output, name);
		copyFileSync(join(dist, directory, "bin/cline"), destination);
		writeFileSync(
			`${destination}.sha256`,
			`${createHash("sha256").update(readFileSync(destination)).digest("hex")}  ${name}\n`,
		);
		writeFileSync(`${destination}.build-id`, `${identity.buildId}\n`);
		writeFileSync(`${destination}.build-epoch`, `${identity.buildEpochMs}\n`);
	}
	copyFileSync(
		resolve(import.meta.dir, "install.sh"),
		join(output, "install.sh"),
	);
}

if (import.meta.main) {
	const dist = resolve(import.meta.dir, "../dist");
	const nativeDirectory = `cli-${process.platform}-${process.arch}`;
	const info = JSON.parse(
		execFileSync(join(dist, nativeDirectory, "bin/cline"), ["--runtime-info"], {
			encoding: "utf8",
			timeout: 10000,
			cwd: tmpdir(),
			env: {
				...process.env,
				BUN_BE_BUN: undefined,
				CLINE_HUB_BUILD_ID: undefined,
				CLINE_HUB_BUILD_EPOCH_MS: undefined,
				CLINE_NO_AUTO_UPDATE: "1",
			},
		}),
	);
	if (!info.compiled)
		throw new Error("Release metadata must come from a compiled CLI");
	collectReleaseAssets(dist, join(dist, "release"), info);
}
