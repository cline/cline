#!/usr/bin/env bun

/** biome-ignore-all lint/style/noNonNullAssertion: expected non-null assertions */

/**
 * Unified release script for SDK packages and CLI.
 *
 * Usage:
 *   bun release sdk                          # auto-increment patch, publish SDK
 *   bun release sdk 0.1.0                    # publish SDK at exact version
 *   bun release sdk 0.1.0 --tag next         # publish SDK with npm tag
 *   bun release cli                          # publish CLI from the current tagged commit
 *   bun release cli 0.1.0                    # require apps/cli/package.json to match
 *   bun release cli --dry-run                # preview without side effects
 *   bun release sdk --skip-tests             # skip the test suite
 *   bun release sdk --skip-git-tags          # skip git tag creation
 */

import { readdir, readFile } from "node:fs/promises";
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

const target = positionals[0] as "sdk" | "cli" | undefined;
const explicitVersion = positionals[1];

if (!target || !["sdk", "cli"].includes(target)) {
	console.error("Usage: bun release <sdk|cli> [version] [options]");
	console.error("");
	console.error("Targets:");
	console.error("  sdk   Publish @clinebot/{shared,llms,agents,core} to npm");
	console.error(
		"  cli   Publish @clinebot/cli from an existing cli-vX.Y.Z git tag",
	);
	console.error("");
	console.error("Options:");
	console.error(
		"  [version]        Semver version (omit to auto-increment patch)",
	);
	console.error('  --tag <tag>      npm dist-tag (default: "latest")');
	console.error("  --dry-run        Preview all steps without side effects");
	console.error("  --skip-tests     Skip running the test suite");
	console.error("  --skip-git-tags  Skip git tag creation");
	console.error("");
	console.error("Examples:");
	console.error("  bun release sdk");
	console.error("  bun release sdk 0.1.0");
	console.error("  bun release sdk 0.1.0 --tag next");
	console.error("  bun release cli");
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
const cliDir = join(root, "apps/cli");

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

async function resolveCliVersion(): Promise<string> {
	const raw = await readFile(join(cliDir, "package.json"), "utf-8");
	const pkg: unknown = JSON.parse(raw);
	const version =
		pkg !== null &&
		typeof pkg === "object" &&
		!Array.isArray(pkg) &&
		"version" in pkg &&
		typeof pkg.version === "string"
			? pkg.version
			: undefined;
	if (!version) {
		throw new Error("Could not determine version from apps/cli/package.json.");
	}
	if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
		throw new Error(`Invalid apps/cli/package.json version: ${version}`);
	}
	if (explicitVersion && explicitVersion !== version) {
		throw new Error(
			`CLI version argument ${explicitVersion} does not match apps/cli/package.json version ${version}. Update apps/cli/package.json first.`,
		);
	}
	return version;
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

async function ensureCleanWorkingTree(): Promise<void> {
	const status = (
		await run(["git", "status", "--porcelain"], { stdout: "pipe" })
	).trim();
	if (status) {
		throw new Error(
			`Working tree is dirty. Commit or stash changes before releasing.\n${status}`,
		);
	}
}

async function ensureCliReleaseTag(version: string): Promise<void> {
	const expectedTag = `cli-v${version}`;
	if (dryRun) {
		console.log(`  [dry-run] Required pushed git tag: ${expectedTag}`);
		return;
	}
	const headCommit = (
		await run(["git", "rev-parse", "HEAD"], { stdout: "pipe" })
	).trim();
	const shortHead = headCommit.slice(0, 12);
	const tagsAtHead = (
		await run(["git", "tag", "--points-at", "HEAD"], { stdout: "pipe" })
	)
		.split(/\r?\n/)
		.map((tag) => tag.trim())
		.filter(Boolean);
	if (!tagsAtHead.includes(expectedTag)) {
		const localTagExists = (
			await run(["git", "tag", "--list", expectedTag], { stdout: "pipe" })
		).trim();
		if (localTagExists) {
			const taggedCommit = (
				await run(["git", "rev-parse", `${expectedTag}^{commit}`], {
					stdout: "pipe",
				})
			).trim();
			throw new Error(
				[
					`Tag ${expectedTag} points at ${taggedCommit.slice(0, 12)}, but current HEAD is ${shortHead}.`,
					"Check out the tagged commit before publishing:",
					`  git checkout ${expectedTag}`,
				].join("\n"),
			);
		}
		throw new Error(
			`Current HEAD is not tagged ${expectedTag}. Create and push the tag before publishing.`,
		);
	}
	const localTagCommit = (
		await run(
			["git", "rev-parse", "-q", "--verify", `${expectedTag}^{commit}`],
			{
				stdout: "pipe",
			},
		)
	).trim();
	if (localTagCommit !== headCommit) {
		throw new Error(
			`Current commit is not tagged ${expectedTag}. Create the tag on HEAD before publishing.`,
		);
	}

	const remoteRefs = (
		await run(
			[
				"git",
				"ls-remote",
				"origin",
				`refs/tags/${expectedTag}`,
				`refs/tags/${expectedTag}^{}`,
			],
			{ stdout: "pipe" },
		)
	)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const remotePeeledRef = remoteRefs.find((line) =>
		line.endsWith(`refs/tags/${expectedTag}^{}`),
	);
	const remoteTagRef = remoteRefs.find((line) =>
		line.endsWith(`refs/tags/${expectedTag}`),
	);
	const remoteTagCommit = (remotePeeledRef ?? remoteTagRef)?.split(/\s+/)[0];
	if (remoteTagCommit !== headCommit) {
		if (remoteTagCommit) {
			throw new Error(
				[
					`Remote tag ${expectedTag} points at ${remoteTagCommit.slice(0, 12)}, but current HEAD is ${shortHead}.`,
					"Check out the tagged commit or push the correct tag before publishing.",
				].join("\n"),
			);
		}
		throw new Error(
			`Remote tag ${expectedTag} must exist on origin and point at HEAD before publishing.`,
		);
	}
	console.log(`  Found pushed git tag: ${expectedTag}`);
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
		header("Step 1/5: Running tests");
		await run(["bun", "run", "test"]);
	} else {
		header("Step 1/5: Skipping tests (--skip-tests)");
	}

	// Step 2: Update versions
	// version.ts handles: version bump -> lockfile regeneration -> generate:models -> format -> build
	header("Step 2/5: Updating package versions and lockfile");
	await run(["bun", "scripts/version.ts", version]);

	// Step 3: Verify publishability
	header("Step 3/5: Verifying packed tarballs");
	await run(["bun", "scripts/check-publish.ts"]);

	// Step 4: Publish in dependency order
	header("Step 4/5: Publishing packages");
	for (const workspace of SDK_PUBLISH_ORDER) {
		const pkgDir = join(packagesDir, workspace);
		const name = `@clinebot/${workspace}`;
		console.log(`  Publishing ${name}@${version} with tag '${npmTag}'...`);
		await run(["bun", "publish", "--tag", npmTag, "--access", "public"], {
			cwd: pkgDir,
		});
	}

	// Step 5: Git tag
	if (npmTag === "latest" && !skipGitTags) {
		header("Step 5/5: Creating git tag");
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
		header("Step 5/5: Skipping git tag (--skip-git-tags)");
	} else {
		header("Step 5/5: Skipping git tag (non-latest channel)");
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
// Builds cross-platform binaries via apps/cli/script/build.ts, then publishes
// the generated platform packages and wrapper package to npm.

async function releaseCLI(version: string): Promise<number> {
	console.log(`\nRelease CLI`);
	console.log(`  Version:     ${version}`);
	console.log(`  Git tag:     cli-v${version}`);
	console.log(`  Tag:         ${npmTag}`);
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
		header("Step 1/3: Running tests");
		await run(["bun", "run", "test"]);
	} else {
		header("Step 1/3: Skipping tests (--skip-tests)");
	}

	// Step 2: Build all platform binaries
	header("Step 2/3: Cross-compiling for all platforms");
	await run(["bun", "script/build.ts", "--install-native-variants"], {
		cwd: cliDir,
	});

	// Step 3: Publish to npm
	header("Step 3/3: Publishing to npm");
	const npmArgs = ["bun", "script/publish-npm.ts", "--tag", npmTag];
	if (dryRun) {
		npmArgs.push("--dry-run");
	}
	await run(npmArgs, { cwd: cliDir });

	console.log(`\n${"═".repeat(60)}`);
	if (dryRun) {
		console.log("  Dry run complete. CLI was not published.");
	} else {
		console.log(`  CLI v${version} published to npm.`);
		console.log("");
		console.log("  Install via npm:");
		console.log("    npm install -g @clinebot/cli");
	}
	console.log(`${"═".repeat(60)}\n`);

	return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

let exitCode: number;
if (target === "sdk") {
	header("Checking branch");
	await ensureMainBranch();
	const version = await resolveVersion();
	exitCode = await releaseSDK(version);
} else {
	header("Checking CLI release tag");
	const version = await resolveCliVersion();
	await ensureCleanWorkingTree();
	await ensureCliReleaseTag(version);
	exitCode = await releaseCLI(version);
}

process.exit(exitCode);
