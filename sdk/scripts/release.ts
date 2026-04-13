#!/usr/bin/env bun

/** biome-ignore-all lint/style/noNonNullAssertion: expected non-null assertions */

/**
 * Unified release script for SDK packages, CLI, and Homebrew.
 *
 * Usage:
 *   bun release sdk                          # auto-increment patch, publish SDK
 *   bun release sdk 0.1.0                    # publish SDK at exact version
 *   bun release sdk 0.1.0 --tag next         # publish SDK with npm tag
 *   bun release cli                          # auto-increment patch, publish CLI
 *   bun release cli 0.1.0                    # publish CLI at exact version
 *   bun release brew                         # build binaries, GitHub release, Homebrew tap
 *   bun release brew --dry-run               # preview without side effects
 *   bun release sdk --skip-tests             # skip the test suite
 *   bun release sdk --skip-git-tags          # skip git tag creation
 */

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		"dry-run": { type: "boolean", default: false },
		tag: { type: "string", default: "latest" },
		"skip-tests": { type: "boolean", default: false },
		"skip-git-tags": { type: "boolean", default: false },
	},
	allowPositionals: true,
	strict: true,
});

const dryRun = values["dry-run"]!;
const npmTag = values.tag!;
const skipTests = values["skip-tests"]!;
const skipGitTags = values["skip-git-tags"]!;

const target = positionals[0] as "sdk" | "cli" | "brew" | undefined;
const explicitVersion = positionals[1];

if (!target || !["sdk", "cli", "brew"].includes(target)) {
	console.error("Usage: bun release <sdk|cli|brew> [version] [options]");
	console.error("");
	console.error("Targets:");
	console.error("  sdk   Publish @clinebot/{shared,llms,agents,core} to npm");
	console.error(
		"  cli   Full CLI release: version bump, tests, build, GitHub release, Homebrew tap, git tag",
	);
	console.error(
		"  brew  Homebrew-only: build binaries, GitHub release, push cask to tap (no version bump or tests)",
	);
	console.error("");
	console.error("Options:");
	console.error(
		"  [version]        Semver version (omit to auto-increment patch)",
	);
	console.error(
		'  --tag <tag>      npm dist-tag (default: "latest", sdk only)',
	);
	console.error("  --dry-run        Preview all steps without side effects");
	console.error("  --skip-tests     Skip running the test suite");
	console.error("  --skip-git-tags  Skip git tag creation");
	console.error("");
	console.error("Examples:");
	console.error("  bun release sdk");
	console.error("  bun release sdk 0.1.0");
	console.error("  bun release sdk 0.1.0 --tag next");
	console.error("  bun release cli --dry-run");
	console.error("  bun release brew");
	process.exit(1);
}

if (explicitVersion && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(explicitVersion)) {
	console.error(`Invalid semver version: ${explicitVersion}`);
	process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SDK_PUBLISH_ORDER = ["shared", "llms", "agents", "core"] as const;
const MAIN_BRANCH = "main";
const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");

// ── Helpers ───────────────────────────────────────────────────────────────────

function header(msg: string): void {
	console.log(`\n${"─".repeat(60)}`);
	console.log(`  ${msg}`);
	console.log(`${"─".repeat(60)}\n`);
}

async function run(
	cmd: string[],
	options: { cwd?: string; stdout?: "inherit" | "pipe" } = {},
): Promise<string> {
	const cwd = options.cwd ?? root;
	const label = cmd.join(" ");

	if (dryRun) {
		console.log(`  [dry-run] ${label}`);
		return "";
	}

	console.log(`  $ ${label}`);

	const proc = Bun.spawn(cmd, {
		cwd,
		stdin: "inherit",
		stdout: options.stdout ?? "inherit",
		stderr: "inherit",
	});

	const exitCode = await proc.exited;
	const stdout =
		options.stdout === "pipe" && proc.stdout
			? await new Response(proc.stdout).text()
			: "";

	if (exitCode !== 0) {
		throw new Error(`Command failed (exit ${exitCode}): ${label}`);
	}
	return stdout;
}

async function confirm(prompt: string): Promise<boolean> {
	process.stdout.write(`${prompt} [y/N] `);
	for await (const line of console) {
		const answer = line.trim().toLowerCase();
		return answer === "y" || answer === "yes";
	}
	return false;
}

function incrementPatchVersion(input: string): string {
	const match = input.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/);
	if (!match) {
		throw new Error(`Invalid semver version: ${input}`);
	}
	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number(patch) + 1}`;
}

async function resolveVersion(): Promise<string> {
	if (explicitVersion) return explicitVersion;

	// Read the current version from the first workspace package that has one,
	// same logic as version.ts.
	const dirs = await readdir(packagesDir, { withFileTypes: true });
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue;
		try {
			const raw = await readFile(
				join(packagesDir, dir.name, "package.json"),
				"utf-8",
			);
			const pkg = JSON.parse(raw);
			if (typeof pkg.version === "string" && pkg.version !== "0.0.0") {
				const next = incrementPatchVersion(pkg.version);
				console.log(
					`  No version specified, auto-incrementing: ${pkg.version} -> ${next}`,
				);
				return next;
			}
		} catch {
			// skip
		}
	}
	throw new Error(
		"Could not determine current version from workspace packages.",
	);
}

async function ensureMainBranch(): Promise<void> {
	const branch = (
		await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { stdout: "pipe" })
	).trim();

	if (dryRun) {
		console.log(`  [dry-run] Current branch: ${branch || "(unknown)"}`);
		return;
	}

	if (branch === MAIN_BRANCH) {
		console.log(`  Already on ${MAIN_BRANCH}`);
		return;
	}

	// Check for uncommitted changes before switching
	const status = (
		await run(["git", "status", "--porcelain"], { stdout: "pipe" })
	).trim();
	if (status) {
		throw new Error(
			`Working tree is dirty. Commit or stash changes before releasing.\n${status}`,
		);
	}

	console.log(`  Switching from ${branch} to ${MAIN_BRANCH}...`);
	await run(["git", "checkout", MAIN_BRANCH]);
	await run(["git", "pull", "--ff-only"]);
}

async function getPublishedPackages(): Promise<
	{ name: string; workspace: string }[]
> {
	const dirs = await readdir(packagesDir, { withFileTypes: true });
	const packages: { name: string; workspace: string }[] = [];

	for (const dir of dirs) {
		if (!dir.isDirectory()) continue;
		try {
			const raw = await readFile(
				join(packagesDir, dir.name, "package.json"),
				"utf-8",
			);
			const pkg = JSON.parse(raw);
			if (!pkg.internal && typeof pkg.name === "string") {
				packages.push({ name: pkg.name, workspace: dir.name });
			}
		} catch {
			// skip directories without package.json
		}
	}
	return packages;
}

// ── SDK Release ───────────────────────────────────────────────────────────────

async function releaseSDK(version: string): Promise<number> {
	const published = await getPublishedPackages();
	const packageNames = published.map((p) => p.name);

	console.log(`\nRelease SDK`);
	console.log(`  Version:     ${version}`);
	console.log(`  Tag:         ${npmTag}`);
	console.log(`  Dry run:     ${dryRun}`);
	console.log(`  Skip tests:  ${skipTests}`);
	console.log(`  Packages:    ${packageNames.join(", ")}`);

	if (!dryRun) {
		const ok = await confirm("\nProceed with SDK release?");
		if (!ok) {
			console.log("Aborted.");
			return 1;
		}
	}

	// Step 1: Tests
	if (!skipTests) {
		header("Step 1/6: Running tests");
		await run(["bun", "run", "test"]);
	} else {
		header("Step 1/6: Skipping tests (--skip-tests)");
	}

	// Step 2: Update versions
	// version.ts handles: version bump -> generate:models -> format -> build
	header("Step 2/6: Updating package versions");
	await run(["bun", "scripts/version.ts", version]);

	// Step 3: Regenerate lockfile
	// With Bun 1.3.10, bun pm pack resolves workspace:* versions from bun.lock.
	// A stale lockfile can keep old workspace package versions.
	header("Step 3/6: Regenerating lockfile");
	const lockPath = join(root, "bun.lock");
	if (!dryRun) {
		try {
			await rm(lockPath);
			console.log("  Removed stale bun.lock");
		} catch {
			console.log("  No existing bun.lock to remove");
		}
	} else {
		console.log("  [dry-run] rm bun.lock");
	}
	await run(["bun", "install", "--lockfile-only"]);

	// Step 4: Verify publishability
	header("Step 4/6: Verifying packed tarballs");
	await run(["bun", "scripts/check-publish.ts"]);

	// Step 5: Publish in dependency order
	header("Step 5/6: Publishing packages");
	for (const workspace of SDK_PUBLISH_ORDER) {
		const pkgDir = join(packagesDir, workspace);
		const name = `@clinebot/${workspace}`;
		console.log(`  Publishing ${name}@${version} with tag '${npmTag}'...`);
		await run(["bun", "publish", "--tag", npmTag, "--access", "public"], {
			cwd: pkgDir,
		});
	}

	// Step 6: Git tag
	if (npmTag === "latest" && !skipGitTags) {
		header("Step 6/6: Creating git tag");
		const gitTag = `sdk-v${version}`;
		console.log(`  Creating tag: ${gitTag}`);
		await run(["git", "tag", "-a", gitTag, "-m", `SDK v${version}`]);

		if (!dryRun) {
			const pushOk = await confirm(
				"\nPush tag to remote? This makes the release public.",
			);
			if (pushOk) {
				await run(["git", "push", "origin", `refs/tags/${gitTag}`]);
			} else {
				console.log(`  Skipped pushing tag. Push manually with:`);
				console.log(`    git push origin refs/tags/${gitTag}`);
			}
		}
	} else if (skipGitTags) {
		header("Step 6/6: Skipping git tag (--skip-git-tags)");
	} else {
		header("Step 6/6: Skipping git tag (non-latest channel)");
	}

	// Done
	console.log(`\n${"═".repeat(60)}`);
	if (dryRun) {
		console.log("  Dry run complete. No SDK packages were published.");
	} else {
		console.log(`  Published SDK packages with tag '${npmTag}':`);
		for (const workspace of SDK_PUBLISH_ORDER) {
			console.log(`    - @clinebot/${workspace}@${version}`);
		}
	}
	console.log(`${"═".repeat(60)}\n`);

	return 0;
}

// ── CLI Release ───────────────────────────────────────────────────────────────
// Delegates to the existing publish-cli-homebrew.ts which handles cross-platform
// builds, GitHub release, and Homebrew tap push.

async function releaseCLI(version: string): Promise<number> {
	console.log(`\nRelease CLI`);
	console.log(`  Version:     ${version}`);
	console.log(`  Dry run:     ${dryRun}`);
	console.log(`  Skip tests:  ${skipTests}`);

	if (!dryRun) {
		const ok = await confirm("\nProceed with CLI release?");
		if (!ok) {
			console.log("Aborted.");
			return 1;
		}
	}

	// Step 1: Tests
	if (!skipTests) {
		header("Step 1/5: Running tests");
		await run(["bun", "run", "test"]);
	} else {
		header("Step 1/5: Skipping tests (--skip-tests)");
	}

	// Step 2: Update versions (so CLI picks up the right SDK versions)
	header("Step 2/5: Updating package versions");
	await run(["bun", "scripts/version.ts", version]);

	// Step 3: Regenerate lockfile
	header("Step 3/5: Regenerating lockfile");
	const lockPath = join(root, "bun.lock");
	if (!dryRun) {
		try {
			await rm(lockPath);
			console.log("  Removed stale bun.lock");
		} catch {
			console.log("  No existing bun.lock to remove");
		}
	} else {
		console.log("  [dry-run] rm bun.lock");
	}
	await run(["bun", "install", "--lockfile-only"]);

	// Step 4: Delegate to publish-cli-homebrew.ts
	// It handles: build SDK, build CLI bundle, cross-compile, GitHub release,
	// Homebrew cask generation, and tap push.
	header("Step 4/5: Building and publishing CLI");
	const cliArgs = ["bun", "scripts/publish-cli-homebrew.ts"];
	if (dryRun) {
		cliArgs.push("--dry-run");
	}
	await run(cliArgs);

	// Step 5: Git tag
	if (!skipGitTags) {
		header("Step 5/5: Creating git tag");
		const gitTag = `cli-v${version}`;
		console.log(`  Creating tag: ${gitTag}`);
		await run(["git", "tag", "-a", gitTag, "-m", `CLI v${version}`]);

		if (!dryRun) {
			const pushOk = await confirm(
				"\nPush tag to remote? This makes the release public.",
			);
			if (pushOk) {
				await run(["git", "push", "origin", `refs/tags/${gitTag}`]);
			} else {
				console.log(`  Skipped pushing tag. Push manually with:`);
				console.log(`    git push origin refs/tags/${gitTag}`);
			}
		}
	} else {
		header("Step 5/5: Skipping git tag (--skip-git-tags)");
	}

	console.log(`\n${"═".repeat(60)}`);
	if (dryRun) {
		console.log("  Dry run complete. CLI was not published.");
	} else {
		console.log(`  CLI v${version} released.`);
		console.log("");
		console.log("  Install or upgrade via Homebrew:");
		console.log(
			"    brew upgrade cline/internal-tap/cline 2>/dev/null || brew install cline/internal-tap/cline",
		);
	}
	console.log(`${"═".repeat(60)}\n`);

	return 0;
}

// ── Brew Release ──────────────────────────────────────────────────────────────
// Runs publish-cli-homebrew.ts directly — no version bump, no tests.
// Useful for re-publishing to the Homebrew tap when the GitHub release already
// exists or when you only need to update the cask.

async function releaseBrew(): Promise<number> {
	console.log(`\nRelease Brew`);
	console.log(`  Dry run:     ${dryRun}`);

	if (!dryRun) {
		const ok = await confirm(
			"\nThis will build CLI binaries, create/update the GitHub release, and push the cask to the Homebrew tap. Proceed?",
		);
		if (!ok) {
			console.log("Aborted.");
			return 1;
		}
	}

	header("Step 1/1: Building and publishing to Homebrew");
	const args = ["bun", "scripts/publish-cli-homebrew.ts"];
	if (dryRun) {
		args.push("--dry-run");
	}
	await run(args);

	console.log(`\n${"═".repeat(60)}`);
	if (dryRun) {
		console.log("  Dry run complete. Nothing was published.");
	} else {
		console.log("  Homebrew tap updated.");
		console.log("");
		console.log("  Install or upgrade:");
		console.log(
			"    brew upgrade cline/internal-tap/cline 2>/dev/null || brew install cline/internal-tap/cline",
		);
	}
	console.log(`${"═".repeat(60)}\n`);

	return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

header("Checking branch");
await ensureMainBranch();

let exitCode: number;

if (target === "brew") {
	exitCode = await releaseBrew();
} else {
	const version = await resolveVersion();
	exitCode =
		target === "sdk" ? await releaseSDK(version) : await releaseCLI(version);
}

process.exit(exitCode);
