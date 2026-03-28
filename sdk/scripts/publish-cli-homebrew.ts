#!/usr/bin/env bun

/**
 * publish-cli-homebrew.ts
 *
 * Builds cross-platform CLI tarballs, creates a GitHub release on cline/sdk-wip,
 * uploads the tarballs as release assets, generates the Homebrew Cask formula
 * from template.rb, and pushes it to cline/homebrew-internal-tap.
 *
 * Usage:
 *   bun scripts/publish-cli-homebrew.ts [--dry-run]
 *
 * Prerequisites:
 *   - bun, gh (GitHub CLI), git
 *   - gh must be authenticated with access to cline/sdk-wip and cline/homebrew-internal-tap
 *   - Run from the repo root
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ── Config ──────────────────────────────────────────────────────────────────

const REPO = "cline/sdk-wip";
const TAP_REPO = "cline/homebrew-internal-tap";

const ROOT_DIR = join(import.meta.dir, "..");
const CLI_DIR = join(ROOT_DIR, "apps/cli");
const TEMPLATE_PATH = join(CLI_DIR, "template.rb");
const STAGING_DIR = join(ROOT_DIR, ".cli-release-staging");

const TARGETS = [
	{ bunTarget: "bun-darwin-arm64", platform: "darwin-arm64" },
	{ bunTarget: "bun-darwin-x64", platform: "darwin-x64" },
	{ bunTarget: "bun-linux-x64", platform: "linux-x64" },
	{ bunTarget: "bun-linux-arm64", platform: "linux-arm64" },
] as const;

// ── Args ────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		"dry-run": { type: "boolean", default: false },
	},
	strict: true,
});

const DRY_RUN = values["dry-run"] ?? false;

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) {
	console.log(`==> ${msg}`);
}

async function run(
	cmd: string[],
	opts?: { cwd?: string },
): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd ?? ROOT_DIR,
		stdout: "pipe",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	if (exitCode !== 0) {
		throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}`);
	}
	return { stdout: stdout.trim(), exitCode };
}

async function exec(cmd: string[], opts?: { cwd?: string }): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd ?? ROOT_DIR,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}`);
	}
}

function sha256File(path: string): string {
	const data = readFileSync(path);
	return createHash("sha256").update(data).digest("hex");
}

function cleanup() {
	rmSync(STAGING_DIR, { recursive: true, force: true });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
	// Cleanup on exit
	process.on("exit", cleanup);
	process.on("SIGINT", () => {
		cleanup();
		process.exit(1);
	});

	// ── Resolve version ─────────────────────────────────────────────────

	const cliPkg = JSON.parse(
		readFileSync(join(CLI_DIR, "package.json"), "utf-8"),
	);
	let version: string = cliPkg.version;

	if (version === "0.0.0") {
		const sharedPkg = JSON.parse(
			readFileSync(
				join(ROOT_DIR, "packages/shared/package.json"),
				"utf-8",
			),
		);
		version = sharedPkg.version;
	}

	const tag = `v${version}`;
	log(`Version: ${version}  Tag: ${tag}`);

	// ── Build SDK + CLI bundle ──────────────────────────────────────────

	log("Building SDK...");
	await exec(["bun", "run", "build:sdk"]);

	log("Building CLI bundle...");
	await exec(["bun", "-F", "@clinebot/cli", "build"]);

	// ── Cross-compile binaries & create tarballs ────────────────────────

	rmSync(STAGING_DIR, { recursive: true, force: true });
	mkdirSync(STAGING_DIR, { recursive: true });

	const tarballPaths: Record<string, string> = {};

	for (const { bunTarget, platform } of TARGETS) {
		const tarballName = `cline-${version}-${platform}.tar.gz`;
		const buildDir = join(STAGING_DIR, platform);
		mkdirSync(buildDir, { recursive: true });

		log(`Compiling for ${platform} (target: ${bunTarget})...`);

		await exec([
			"bun",
			"build",
			join(CLI_DIR, "src/index.ts"),
			"--compile",
			"--target",
			bunTarget,
			"--outfile",
			join(buildDir, "cline"),
			"--external",
			"@anthropic-ai/vertex-sdk",
		]);

		// Copy the plugin sandbox bootstrap if it exists
		const bootstrapSrc = join(
			ROOT_DIR,
			"packages/core/dist/agents/plugin-sandbox-bootstrap.js",
		);
		if (existsSync(bootstrapSrc)) {
			const bootstrapDir = join(buildDir, "agents");
			mkdirSync(bootstrapDir, { recursive: true });
			const content = readFileSync(bootstrapSrc);
			await Bun.write(join(bootstrapDir, "plugin-sandbox-bootstrap.js"), content);
		}

		log(`Creating tarball: ${tarballName}`);
		await exec(["tar", "-czf", join(STAGING_DIR, tarballName), "-C", buildDir, "."]);

		tarballPaths[platform] = join(STAGING_DIR, tarballName);
	}

	// ── Compute SHA256 hashes ───────────────────────────────────────────

	log("Computing SHA256 hashes...");

	const hashes: Record<string, string> = {};
	for (const { platform } of TARGETS) {
		hashes[platform] = sha256File(tarballPaths[platform]);
		log(`  ${platform}: ${hashes[platform]}`);
	}

	// ── Create GitHub release & upload assets ───────────────────────────

	if (DRY_RUN) {
		log(`[dry-run] Would create release ${tag} on ${REPO} and upload ${TARGETS.length} tarballs`);
	} else {
		log(`Creating GitHub release ${tag} on ${REPO}...`);

		// Delete existing release if it exists (for re-runs)
		try {
			await run(["gh", "release", "view", tag, "--repo", REPO]);
			log(`Release ${tag} already exists, deleting...`);
			await exec(["gh", "release", "delete", tag, "--repo", REPO, "--yes", "--cleanup-tag"]);
		} catch {
			// Release doesn't exist, that's fine
		}

		await exec([
			"gh",
			"release",
			"create",
			tag,
			"--repo",
			REPO,
			"--title",
			`CLI ${version}`,
			"--notes",
			`Cline CLI v${version}`,
			"--draft=false",
			tarballPaths["darwin-arm64"],
			tarballPaths["darwin-x64"],
			tarballPaths["linux-x64"],
			tarballPaths["linux-arm64"],
		]);

		log(`Release ${tag} created with all assets uploaded.`);
	}

	// ── Generate Cask formula from template ─────────────────────────────

	log("Generating Cask formula from template...");

	let caskContent = readFileSync(TEMPLATE_PATH, "utf-8");
	caskContent = caskContent.replace(/__CLI_VERSION__/g, version);
	caskContent = caskContent.replace(/__CLI_MAC_ARM_SHA256__/g, hashes["darwin-arm64"]);
	caskContent = caskContent.replace(/__CLI_MAC_INTEL_SHA256__/g, hashes["darwin-x64"]);
	caskContent = caskContent.replace(/__CLI_LINUX_SHA256__/g, hashes["linux-x64"]);
	caskContent = caskContent.replace(/__CLI_LINUX_ARM_SHA256__/g, hashes["linux-arm64"]);

	const caskFile = join(STAGING_DIR, "cline.rb");
	await Bun.write(caskFile, caskContent);

	log("Generated cask formula:");
	console.log("---");
	console.log(caskContent);
	console.log("---");

	// ── Push to homebrew-internal-tap ───────────────────────────────────

	if (DRY_RUN) {
		log(`[dry-run] Would push Casks/cline.rb to ${TAP_REPO}`);
	} else {
		const tapClone = join(STAGING_DIR, "homebrew-internal-tap");

		log(`Cloning ${TAP_REPO}...`);
		await exec(["gh", "repo", "clone", TAP_REPO, tapClone, "--", "--depth", "1"]);

		mkdirSync(join(tapClone, "Casks"), { recursive: true });
		const caskData = readFileSync(caskFile);
		await Bun.write(join(tapClone, "Casks", "cline.rb"), caskData);

		log(`Pushing Casks/cline.rb to ${TAP_REPO}...`);

		await exec(["git", "add", "Casks/cline.rb"], { cwd: tapClone });

		// Check if there are staged changes
		const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
			cwd: tapClone,
		});

		if (diffResult.exitCode === 0) {
			log("No changes to Casks/cline.rb, skipping push.");
		} else {
			await exec(
				["git", "commit", "-m", `Update cline cask to v${version}`],
				{ cwd: tapClone },
			);
			await exec(["git", "push", "origin", "HEAD"], { cwd: tapClone });
			log(`Pushed Casks/cline.rb to ${TAP_REPO}`);
		}
	}

	log(`Done! Cline CLI v${version} published.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
