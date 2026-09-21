import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type Bump,
	type Product,
	prepare,
	releaseTags,
	run,
	validate,
} from "./plan";

/** Rehearse against a disposable repository, never the contributor's refs or files. */
export function dryRun(
	source: string,
	bumps: Record<Product, Bump>,
	options: { skipLockfile?: boolean } = {},
) {
	const directory = mkdtempSync(join(tmpdir(), "cline-release-dry-run-"));
	const checkout = join(directory, "checkout");
	console.log(`Dry-run artifacts: ${directory}`);
	// Local clone keeps history/tags for changelog generation; no remote fetch occurs.
	run(["git", "clone", "--shared", "--no-hardlinks", source, checkout]);
	run(["git", "remote", "remove", "origin"], checkout);
	run(["git", "config", "user.name", "Release dry run"], checkout);
	run(
		["git", "config", "user.email", "release-dry-run@example.invalid"],
		checkout,
	);
	run(["git", "config", "commit.gpgsign", "false"], checkout);
	const rawGit = (args: string[], cwd: string) => {
		const result = Bun.spawnSync(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout;
	};
	const patch = rawGit(["diff", "--binary", "HEAD"], source);
	if (patch.length) {
		const patchPath = join(directory, "working-tree.patch");
		writeFileSync(patchPath, patch);
		run(["git", "apply", patchPath], checkout);
	}
	const untracked = rawGit(
		["ls-files", "--others", "--exclude-standard", "-z"],
		source,
	).toString();
	for (const path of untracked.split("\0").filter(Boolean)) {
		mkdirSync(dirname(join(checkout, path)), { recursive: true });
		copyFileSync(join(source, path), join(checkout, path));
	}
	const commit = (message: string) => {
		run(["git", "add", "--all"], checkout);
		run(
			[
				"git",
				"-c",
				"core.hooksPath=/dev/null",
				"commit",
				"--allow-empty",
				"-m",
				message,
			],
			checkout,
		);
		return run(["git", "rev-parse", "HEAD"], checkout);
	};
	const base = commit("Local dry-run input snapshot");
	run(["git", "update-ref", "refs/remotes/origin/main", base], checkout);
	const plan = prepare(checkout, bumps);
	if (!options.skipLockfile) {
		if (!existsSync(join(checkout, "bun.lock")))
			throw new Error(
				"Missing bun.lock; use --skip-lockfile only for a partial rehearsal",
			);
		run(
			[process.execPath, "install", "--lockfile-only", "--ignore-scripts"],
			checkout,
		);
	}
	// Stage the plan too, so the preview includes newly created files.
	run(["git", "add", "--all"], checkout);
	writeFileSync(
		join(directory, "release.patch"),
		rawGit(["diff", "--cached", "--binary"], checkout),
	);
	const sha = commit("Simulated release merge");
	validate(checkout, sha, "pull-request");
	run(["git", "update-ref", "refs/remotes/origin/main", sha], checkout);
	validate(checkout, sha);
	const report = {
		mode: "dry-run",
		plan,
		lockfile: options.skipLockfile ? "skipped" : "resolved",
		validation: ["pull-request", "merged"],
		plannedTags: releaseTags(plan),
		publishOrder: ["sdk", "cli", "desktop"],
	};
	writeFileSync(
		join(directory, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
	console.log(
		`Passed. Review ${join(directory, "release.patch")}. No release tags, pushes, PRs, or publications were made.`,
	);
	return { directory, checkout, report };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== "--skip-lockfile"))
		throw new Error("Usage: bun run release:dry-run [--skip-lockfile]");
	dryRun(
		run(["git", "rev-parse", "--show-toplevel"]),
		{
			sdk: (process.env.SDK_BUMP || "patch") as Bump,
			cli: (process.env.CLI_BUMP || "patch") as Bump,
			desktop: (process.env.DESKTOP_BUMP || "patch") as Bump,
		},
		{ skipLockfile: args.includes("--skip-lockfile") },
	);
}
