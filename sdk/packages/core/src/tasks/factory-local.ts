import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import {
	type AgendaTaskRecord,
	FACTORY_ARTIFACT_EXTENSIONS,
	FACTORY_PUBLISH_FAILURE_PREFIX,
	type FactoryArtifact,
	type FactoryCheck,
	type FactoryCheckResult,
	type FactoryWorkspace,
	factoryArtifactPathProblem,
	factoryCheckConfigurationFindings,
	factoryDeliverable,
	factoryWorkspaceSchema,
} from "@cline/shared";
import { z } from "zod";
import type { FactoryCaptureFile } from "./factory-browser";
import {
	FactoryDecisionError,
	FactoryDeferredError,
	FactoryPublishError,
} from "./factory-errors";
import {
	type FactoryChangedFile,
	type FactoryPullRequestContext,
	replaceFactoryEvidenceSection,
} from "./factory-evidence";
import { parseFactoryGitHubRemote } from "./factory-review-input";

export {
	FACTORY_ARTIFACT_EXTENSIONS,
	factoryArtifactPathProblem,
	factoryCheckConfigurationFindings,
};

const OUTPUT_BYTES = 32_768;
/** The largest diff Factory reviews, in bytes. */
export const FACTORY_DIFF_BYTES = 250_000;
/** Time limit of one check command. */
export const CHECK_TIMEOUT_MS = 10 * 60_000;

function key(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** Kills a Factory-spawned process and everything in its process group or tree. */
export function killFactoryProcessTree(pid: number): void {
	if (process.platform === "win32") {
		const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		killer.on("error", () => {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		});
		killer.unref();
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

/**
 * Environment for every git and gh command Factory runs: no terminal or
 * askpass credential prompt, so a command that needs a person fails at once
 * instead of waiting for input nobody will give. Credential helpers and SSH
 * keys that need no prompt still work.
 */
export const FACTORY_NONINTERACTIVE_ENV: Readonly<Record<string, string>> = {
	GIT_TERMINAL_PROMPT: "0",
	// Empty stops git's askpass lookup (GIT_ASKPASS, core.askPass, SSH_ASKPASS).
	GIT_ASKPASS: "",
	SSH_ASKPASS_REQUIRE: "never",
	GCM_INTERACTIVE: "never",
	GH_PROMPT_DISABLED: "1",
};

/**
 * Variables of the Hub's environment a repository stage command keeps
 * (`environment: "allowlisted"`); everything else, API keys included, is
 * dropped. Tools that keep credentials in files under HOME still work.
 */
const FACTORY_COMMAND_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TMPDIR",
	"TZ",
] as const;

function allowlistedEnvironment(): NodeJS.ProcessEnv {
	const env: Record<string, string> = {};
	for (const name of FACTORY_COMMAND_ENV_ALLOWLIST) {
		const value = process.env[name];
		if (value !== undefined) env[name] = value;
	}
	// Only the allowlist, on purpose: the app's (Next.js) typings make
	// NODE_ENV a required ProcessEnv key.
	return env as NodeJS.ProcessEnv;
}

export async function runFactoryCommand(input: {
	cwd: string;
	file: string;
	args: string[];
	signal?: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
	/** Merged over the hub's own environment (or the allowlisted part of it). */
	env?: Record<string, string>;
	/**
	 * `allowlisted`: start from FACTORY_COMMAND_ENV_ALLOWLIST only, never the
	 * Hub's whole environment. Unset keeps the Hub's environment.
	 */
	environment?: "allowlisted";
	/** Called with the spawned process id, before the command finishes. */
	onSpawn?: (pid: number) => void;
	/** Also returns stdout alone, for commands whose stdout is parsed. */
	captureStdout?: boolean;
	/** Written to the command's standard input, which is otherwise closed. */
	stdin?: string;
}): Promise<{
	exitCode: number | null;
	/** stdout and stderr interleaved. */
	output: string;
	/** Set only with `captureStdout`. */
	stdout?: string;
	truncated: boolean;
	timedOut: boolean;
}> {
	input.signal?.throwIfAborted();
	const env =
		input.environment === "allowlisted"
			? { ...allowlistedEnvironment(), ...input.env }
			: input.file === "git" || input.file === "gh"
				? { ...process.env, ...FACTORY_NONINTERACTIVE_ENV, ...input.env }
				: input.env && { ...process.env, ...input.env };
	const child = spawn(input.file, input.args, {
		cwd: input.cwd,
		env,
		stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		detached: process.platform !== "win32",
		windowsHide: true,
	});
	if (child.pid) input.onSpawn?.(child.pid);
	// A command that exits before reading its input must not fail the write.
	child.stdin?.on("error", () => {});
	child.stdin?.end(input.stdin);
	const chunks: Buffer[] = [];
	const stdoutChunks: Buffer[] = [];
	let bytes = 0;
	let stdoutBytes = 0;
	let truncated = false;
	let timedOut = false;
	const limit = input.maxBytes ?? OUTPUT_BYTES;
	const collect = (chunk: Buffer) => {
		const remaining = limit - bytes;
		if (chunk.length > remaining) truncated = true;
		if (remaining > 0) {
			const kept = chunk.subarray(0, remaining);
			chunks.push(kept);
			bytes += kept.length;
		}
	};
	child.stdout?.on("data", (chunk: Buffer) => {
		collect(chunk);
		if (!input.captureStdout) return;
		const remaining = limit - stdoutBytes;
		if (chunk.length > remaining) truncated = true;
		if (remaining > 0) {
			const kept = chunk.subarray(0, remaining);
			stdoutChunks.push(kept);
			stdoutBytes += kept.length;
		}
	});
	child.stderr?.on("data", collect);
	const kill = () => {
		if (child.pid) killFactoryProcessTree(child.pid);
	};
	input.signal?.addEventListener("abort", kill, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, input.timeoutMs ?? 60_000);
	try {
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", () => {
				// Checks may leave a server holding the pipes after their shell exits.
				kill();
			});
			child.once("close", resolve);
		});
		input.signal?.throwIfAborted();
		return {
			exitCode,
			output: Buffer.concat(chunks).toString("utf8"),
			...(input.captureStdout
				? { stdout: Buffer.concat(stdoutChunks).toString("utf8") }
				: {}),
			truncated,
			timedOut,
		};
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", kill);
	}
}

/**
 * Configuration of every review git command: no hooks, fsmonitor, submodule
 * recursion, `ext::` remotes or automatic maintenance, and symbolic links
 * are checked out as plain files.
 */
const FACTORY_REVIEW_GIT_CONFIG = [
	`core.hooksPath=${devNull}`,
	"core.fsmonitor=false",
	"core.symlinks=false",
	"submodule.recurse=false",
	"fetch.recurseSubmodules=false",
	"protocol.ext.allow=never",
	"gc.auto=0",
	"maintenance.auto=false",
];

/**
 * Runs git on a pull request review's checkout, or on the user's repository
 * for it: hooks, fsmonitor, submodules, symbolic links and every filter
 * driver configured where it runs (`cwd`, conditional includes as they
 * evaluate there; git-lfs included) are off, so no code from the user's
 * configuration runs on the pull request's files and none from the pull
 * request runs at all. Every review git command goes through here.
 */
export async function runFactoryReviewGit(
	input: Omit<Parameters<typeof runFactoryCommand>[0], "file" | "env">,
): ReturnType<typeof runFactoryCommand> {
	const drivers = await runFactoryCommand({
		cwd: input.cwd,
		file: "git",
		args: [
			"config",
			"--null",
			"--name-only",
			"--get-regexp",
			"^filter\\..+\\.(clean|smudge|process|required)$",
		],
		signal: input.signal,
	});
	if (drivers.exitCode !== 0 && drivers.exitCode !== 1)
		throw new Error("Could not read the repository's git filters.");
	const filters = new Set(
		drivers.output
			.split("\0")
			.map((name) => /^filter\.([\s\S]+)\.[a-z]+$/.exec(name)?.[1])
			.filter((name): name is string => name !== undefined),
	);
	const settings = [...FACTORY_REVIEW_GIT_CONFIG];
	for (const name of filters) {
		if (/[=\n]/.test(name))
			throw new Error(
				"A git filter driver's name cannot be neutralised; rename it in git config.",
			);
		settings.push(
			`filter.${name}.clean=`,
			`filter.${name}.smudge=`,
			`filter.${name}.process=`,
			`filter.${name}.required=false`,
		);
	}
	return runFactoryCommand({
		...input,
		file: "git",
		args: [...settings.flatMap((setting) => ["-c", setting]), ...input.args],
		env: { GIT_LFS_SKIP_SMUDGE: "1" },
	});
}

async function git(input: {
	cwd: string;
	args: string[];
	signal?: AbortSignal;
	maxBytes?: number;
	/** A pull request review's command: see runFactoryReviewGit. */
	review?: boolean;
}): Promise<string> {
	const { review, ...command } = input;
	const result = await (review
		? runFactoryReviewGit(command)
		: runFactoryCommand({ ...command, file: "git" }));
	if (result.exitCode !== 0 || result.timedOut)
		throw new Error(`Git ${input.args[0]} failed: ${result.output}`);
	if (result.truncated)
		throw new Error(
			"Git output exceeds the factory review limit; split this feature into smaller tasks.",
		);
	return input.args.includes("-z") ? result.output : result.output.trim();
}

/**
 * Branches Factory owns: `factory/f-<n>-<slug>` for cards with a short id,
 * and `feat/factory-<hex>` for workspaces created before short ids (kept;
 * an existing branch is never renamed) and for implementation units.
 */
const FACTORY_BRANCH =
	/^(?:feat\/factory-[a-f0-9]{24}|factory\/f-[1-9]\d*(?:-[a-z0-9]+)*)$/;
const BRANCH_SLUG_CHARS = 40;

/** `factory/f-<n>-<slug of title>`, the branch of a new Factory card's work. */
export function factoryBranchName(
	factoryNumber: number,
	title: string,
): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, BRANCH_SLUG_CHARS)
		.replace(/-+$/, "");
	return `factory/f-${factoryNumber}${slug ? `-${slug}` : ""}`;
}

export async function assertOwnedWorkspace(
	workspace: FactoryWorkspace,
	signal?: AbortSignal,
): Promise<void> {
	if (!FACTORY_BRANCH.test(workspace.branch))
		throw new Error("Factory requires its task-owned branch.");
	const review = workspace.baseSource === "pull_request";
	const branch = await git({
		cwd: workspace.path,
		args: ["symbolic-ref", "--short", "HEAD"],
		signal,
		review,
	});
	if (branch !== workspace.branch)
		throw new Error(
			"Factory worktree branch changed; refusing to modify or publish it.",
		);
	await git({
		cwd: workspace.path,
		args: ["merge-base", "--is-ancestor", workspace.baseCommit, "HEAD"],
		signal,
		review,
	});
}

/** A full git object id. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Git output meaning origin needs a credential or key it could not get without a prompt. */
const GIT_SIGN_IN_FAILURE =
	/terminal prompts disabled|could not read (?:Username|Password)|Authentication failed|Invalid username or password|Permission denied \(publickey|Host key verification failed/i;

/**
 * `fallback`, unless `output` shows git could not sign in to origin without
 * a prompt: then a one-sentence `FactoryPublishError` a person can act on.
 */
function originFailure(output: string, fallback: Error): Error {
	return GIT_SIGN_IN_FAILURE.test(output)
		? new FactoryPublishError(
				"Git could not sign in to origin without a prompt; set up a credential helper or SSH key for origin that works without one, then try again.",
			)
		: fallback;
}

/**
 * The exact commit at `refs/heads/<branch>` on origin, from `git ls-remote`
 * (nothing is fetched and no ref changes); undefined when origin has no
 * such branch. Throws `unreachable` (or a sign-in `FactoryPublishError`)
 * when origin cannot be read.
 */
async function originBranchTip(input: {
	cwd: string;
	branch: string;
	unreachable: Error;
	signal?: AbortSignal;
}): Promise<string | undefined> {
	const ref = `refs/heads/${input.branch}`;
	const listed = await runFactoryCommand({
		cwd: input.cwd,
		file: "git",
		args: ["ls-remote", "origin", ref],
		signal: input.signal,
		captureStdout: true,
	});
	if (listed.exitCode !== 0 || listed.timedOut)
		throw originFailure(listed.output, input.unreachable);
	for (const line of (listed.stdout ?? "").split("\n")) {
		const [commit, name] = line.trim().split(/\s+/);
		if (name === ref && commit && OBJECT_ID.test(commit)) return commit;
	}
	return undefined;
}

/** Deletes a Factory-owned ref; best effort, since it only pins objects. */
async function deleteFactoryRef(cwd: string, ref: string): Promise<void> {
	await runFactoryReviewGit({
		cwd,
		args: ["update-ref", "-d", ref],
	}).catch(() => undefined);
}

/**
 * Fetches `commit`, the tip `originBranchTip` read for `branch`, into a
 * Factory-owned `refs/factory/base/<id>` and verifies it. FETCH_HEAD, tags
 * and remote-tracking refs are left alone, so concurrent cards and the
 * user's own fetches cannot change which commit this resolves to. Returns
 * the ref; the caller deletes it once the commit is reachable elsewhere.
 */
async function fetchFactoryBaseCommit(input: {
	cwd: string;
	branch: string;
	commit: string;
	unreachable: Error;
	signal?: AbortSignal;
}): Promise<string> {
	const ref = `refs/factory/base/${randomUUID()}`;
	const run = (args: string[]) =>
		runFactoryCommand({
			cwd: input.cwd,
			file: "git",
			args,
			signal: input.signal,
		});
	const fetch = (source: string) =>
		run([
			"fetch",
			"--quiet",
			"--no-tags",
			"--no-write-fetch-head",
			"--no-recurse-submodules",
			"origin",
			`+${source}:${ref}`,
		]);
	try {
		let fetched = await fetch(input.commit);
		// A server that refuses wants by object id still serves the branch;
		// its tip must still be the commit listed.
		if (fetched.exitCode !== 0 && !GIT_SIGN_IN_FAILURE.test(fetched.output))
			fetched = await fetch(`refs/heads/${input.branch}`);
		if (fetched.exitCode !== 0 || fetched.timedOut)
			throw originFailure(fetched.output, input.unreachable);
		const verified = await run([
			"rev-parse",
			"--verify",
			"--quiet",
			`${ref}^{commit}`,
		]);
		if (verified.exitCode !== 0 || verified.output.trim() !== input.commit)
			throw new Error(
				`Origin's ${input.branch} moved while Factory was reading it; try again.`,
			);
		return ref;
	} catch (error) {
		await deleteFactoryRef(input.cwd, ref);
		throw error;
	}
}

/**
 * Where a card that opens a PR starts, so its PR targets a branch GitHub
 * has: the branch the card names, else `origin`'s default branch, at its
 * remote tip. The tip is the exact commit `git ls-remote` lists, fetched
 * into a Factory-owned ref (never FETCH_HEAD; the local checkout and its
 * refs are not touched). With `keepBaseRef` that ref is returned for the
 * caller to delete once the commit is reachable from the task branch;
 * otherwise it is deleted before returning. The project's checked-out
 * branch is never used implicitly, so a card does not inherit an unrelated
 * working branch as its PR base. Throws a `FactoryPublishError` with a
 * one-sentence fix when there is no `origin`, it cannot be signed in to
 * without a prompt, or the branch is not on it; a `FactoryDeferredError`
 * when reading or fetching from origin fails otherwise (the network or the
 * remote is down), so the card waits instead of stopping.
 */
export async function chooseFactoryPublishBase(input: {
	sourceRoot: string;
	/** A base branch the card names explicitly; it must exist on `origin`. */
	baseBranch?: string;
	keepBaseRef?: boolean;
	signal?: AbortSignal;
}): Promise<{
	baseBranch: string;
	baseCommit: string;
	source: "remote_default";
	note: string;
	/** With `keepBaseRef`: the Factory-owned ref holding `baseCommit`. */
	baseRef?: string;
}> {
	const cwd = input.sourceRoot;
	const run = (args: string[]) =>
		runFactoryCommand({ cwd, file: "git", args, signal: input.signal });
	if ((await run(["remote", "get-url", "origin"])).exitCode !== 0)
		throw new FactoryPublishError(
			"This project has no origin remote; add the GitHub remote as origin, or choose Deliver on a branch.",
		);
	const unreachable = new FactoryDeferredError(
		"Factory could not reach origin to read the branch to start from; it tries again on its own. If this lasts, check the network and the origin remote.",
	);
	const noDefault = new FactoryPublishError(
		"Factory could not find origin's default branch to start from; name the card's base branch, or set origin's HEAD.",
	);
	const named = input.baseBranch?.trim();
	const current = await run(["symbolic-ref", "--short", "HEAD"]);
	const checkedOut = current.exitCode === 0 ? current.output.trim() : "";
	const localNote = (base: string) =>
		checkedOut && checkedOut !== base
			? ` The project's checked-out branch ${checkedOut} is not used; local-only changes are not included.`
			: " Local-only changes are not included.";
	let baseBranch: string;
	if (named) baseBranch = named;
	else {
		const head = await run(["ls-remote", "--symref", "origin", "HEAD"]);
		if (head.exitCode !== 0 || head.timedOut)
			throw originFailure(head.output, unreachable);
		const fallback =
			head.output.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1] ??
			(
				await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
			).output
				.trim()
				.replace(/^origin\//, "");
		if (!fallback) throw noDefault;
		baseBranch = fallback;
	}
	const baseCommit = await originBranchTip({
		cwd,
		branch: baseBranch,
		unreachable,
		signal: input.signal,
	});
	if (!baseCommit)
		throw named
			? new FactoryPublishError(
					`The card's base branch ${named} is not on origin; push it, or clear the card's base branch to start from origin's default branch.`,
				)
			: noDefault;
	const baseRef = await fetchFactoryBaseCommit({
		cwd,
		branch: baseBranch,
		commit: baseCommit,
		unreachable,
		signal: input.signal,
	});
	if (!input.keepBaseRef) await deleteFactoryRef(cwd, baseRef);
	return {
		baseBranch,
		baseCommit,
		source: "remote_default",
		note: named
			? `Work starts from ${named}, the base branch this card names, at ${baseCommit.slice(0, 12)} on origin.${localNote(named)}`
			: `Work starts from origin's default branch ${baseBranch} at ${baseCommit.slice(0, 12)}.${localNote(baseBranch)}`,
		...(input.keepBaseRef ? { baseRef } : {}),
	};
}

export async function prepareFactoryWorkspace(input: {
	sourceRoot: string;
	taskId: string;
	storageDir: string;
	baseline?: Pick<FactoryWorkspace, "baseBranch" | "baseCommit">;
	/** The card opens a PR: start from a branch `origin` has (see `chooseFactoryPublishBase`). */
	publish?: boolean;
	/** For a publishing card: the base branch the card names; otherwise `origin`'s default branch. */
	baseBranch?: string;
	/**
	 * The card's own branch name (see `factoryBranchName`), used when this
	 * creates the workspace and no branch by that name exists locally or on
	 * `origin`; otherwise, and for a workspace that already exists, the
	 * branch is `feat/factory-<hex>`.
	 */
	branchName?: string;
	/**
	 * A pull request review: the worktree checks out the PR's head (fetched
	 * into a Factory-owned ref and verified to be `headSha`) and is based at
	 * its merge base with `baseSha`. A new head gets a new worktree.
	 */
	pullRequest?: { number: number; headSha: string; baseSha: string };
	signal?: AbortSignal;
}): Promise<FactoryWorkspace> {
	const sourceRoot = await realpath(input.sourceRoot);
	const pullRequest = input.pullRequest;
	const review = pullRequest !== undefined;
	const sourceGit = (args: string[]) =>
		review
			? runFactoryReviewGit({ cwd: sourceRoot, args, signal: input.signal })
			: runFactoryCommand({
					cwd: sourceRoot,
					file: "git",
					args,
					signal: input.signal,
				});
	const id = key(
		`${sourceRoot}\0${input.taskId}${pullRequest ? `\0${pullRequest.headSha}` : ""}`,
	);
	const root = path.join(input.storageDir, "factory-worktrees", id);
	const manifest = path.join(root, "workspace.json");
	// Holds a fetched publish base (or a review's head) until the task branch points at it.
	let baseRef: string | undefined;
	try {
		let workspace: FactoryWorkspace;
		try {
			workspace = factoryWorkspaceSchema.parse(
				JSON.parse(await readFile(manifest, "utf8")),
			);
			if (
				workspace.path !== path.join(root, "repo") ||
				(workspace.branch !== `feat/factory-${id}` &&
					!(
						FACTORY_BRANCH.test(workspace.branch) &&
						workspace.branch.startsWith("factory/")
					))
			)
				throw new Error("Factory workspace ownership does not match its task.");
			if (
				input.baseline &&
				(workspace.baseCommit !== input.baseline.baseCommit ||
					workspace.baseBranch !== input.baseline.baseBranch)
			)
				throw new Error(
					"Factory workspace baseline differs from the saved replay source.",
				);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			if (pullRequest)
				baseRef = await fetchFactoryPullRequestHead(
					sourceRoot,
					pullRequest,
					input.signal,
				);
			// Chosen once: an existing manifest keeps its recorded base.
			const published =
				input.publish && !input.baseline
					? await chooseFactoryPublishBase({
							sourceRoot,
							baseBranch: input.baseBranch,
							keepBaseRef: true,
							signal: input.signal,
						})
					: undefined;
			baseRef = published?.baseRef ?? baseRef;
			const baseBranch =
				published?.baseBranch ??
				input.baseline?.baseBranch ??
				(pullRequest ? `pull/${pullRequest.number}` : undefined) ??
				(await git({
					cwd: sourceRoot,
					args: ["symbolic-ref", "--short", "HEAD"],
					signal: input.signal,
				}));
			const baseCommit =
				published?.baseCommit ??
				input.baseline?.baseCommit ??
				(pullRequest
					? await git({
							cwd: sourceRoot,
							args: ["merge-base", pullRequest.headSha, pullRequest.baseSha],
							signal: input.signal,
							review,
						})
					: undefined) ??
				(await git({
					cwd: sourceRoot,
					args: ["rev-parse", "HEAD"],
					signal: input.signal,
				}));
			if (input.baseline) {
				const resolved = await git({
					cwd: sourceRoot,
					args: ["rev-parse", "--verify", `${baseCommit}^{commit}`],
					signal: input.signal,
				});
				if (resolved !== baseCommit)
					throw new Error("Replay requires the exact saved base commit.");
			}
			let branch = `feat/factory-${id}`;
			if (input.branchName && FACTORY_BRANCH.test(input.branchName)) {
				const taken = await sourceGit([
					"show-ref",
					"--quiet",
					`refs/heads/${input.branchName}`,
					`refs/remotes/origin/${input.branchName}`,
				]);
				// Another card (such as one numbered by another Hub database) owns
				// that name: keep the collision-free hashed branch instead.
				if (taken.exitCode === 1) branch = input.branchName;
				else if (taken.exitCode !== 0)
					throw new Error("Could not inspect the task branch.");
			}
			workspace = {
				path: path.join(root, "repo"),
				branch,
				baseBranch,
				baseCommit,
				...(published
					? { baseSource: published.source, baseNote: published.note }
					: pullRequest
						? {
								baseSource: "pull_request" as const,
								baseNote: `The pull request's head ${pullRequest.headSha.slice(0, 12)}, compared with its merge base with ${pullRequest.baseSha.slice(0, 12)}.`,
							}
						: input.publish === false
							? { baseSource: "local_head" as const }
							: {}),
			};
			await mkdir(root, { recursive: true });
			await writeFile(manifest, JSON.stringify(workspace), { flag: "wx" });
		}
		try {
			await stat(workspace.path);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			const branch = await sourceGit([
				"show-ref",
				"--verify",
				"--quiet",
				`refs/heads/${workspace.branch}`,
			]);
			if (branch.exitCode !== 0 && branch.exitCode !== 1)
				throw new Error("Could not inspect the task branch.");
			// A review's files are checked out from inside the new worktree, so
			// the filter drivers neutralised are those its own configuration
			// (conditional includes too) would run there.
			await git({
				cwd: sourceRoot,
				args: [
					"worktree",
					"add",
					...(review ? ["--no-checkout"] : []),
					...(branch.exitCode === 0
						? [workspace.path, workspace.branch]
						: [
								"-b",
								workspace.branch,
								workspace.path,
								pullRequest?.headSha ?? workspace.baseCommit,
							]),
				],
				signal: input.signal,
				review,
			});
			if (review)
				await git({
					cwd: workspace.path,
					args: ["reset", "--hard", "--quiet"],
					signal: input.signal,
					review,
				});
		}
		await assertOwnedWorkspace(workspace, input.signal);
		return workspace;
	} finally {
		if (baseRef) await deleteFactoryRef(sourceRoot, baseRef);
	}
}

/**
 * Fetches a pull request's head into a Factory-owned ref and verifies it is
 * `headSha`; makes sure `baseSha` is present too. Nothing else is written:
 * no FETCH_HEAD, tags or remote-tracking refs. Returns the ref, which the
 * caller deletes once the review branch holds the head.
 */
async function fetchFactoryPullRequestHead(
	cwd: string,
	pullRequest: { number: number; headSha: string; baseSha: string },
	signal?: AbortSignal,
): Promise<string> {
	const ref = `refs/factory/review/${randomUUID()}`;
	const run = (args: string[]) => runFactoryReviewGit({ cwd, args, signal });
	const fetch = (...refspecs: string[]) =>
		run([
			"fetch",
			"--quiet",
			"--no-tags",
			"--no-write-fetch-head",
			"--no-recurse-submodules",
			"origin",
			...refspecs,
		]);
	const unreachable = (output: string) =>
		originFailure(
			output,
			new Error(
				"Factory could not fetch the pull request from origin; check the network and the origin remote, then try again.",
			),
		);
	try {
		const fetched = await fetch(`+refs/pull/${pullRequest.number}/head:${ref}`);
		if (fetched.exitCode !== 0 || fetched.timedOut)
			throw unreachable(fetched.output);
		const head = await run([
			"rev-parse",
			"--verify",
			"--quiet",
			`${ref}^{commit}`,
		]);
		if (head.exitCode !== 0 || head.output.trim() !== pullRequest.headSha)
			throw new Error(
				"The pull request's head moved while Factory was reading it; try again.",
			);
		const hasBase = async () =>
			(await run(["cat-file", "-e", `${pullRequest.baseSha}^{commit}`]))
				.exitCode === 0;
		if (!(await hasBase())) {
			const base = await fetch(pullRequest.baseSha);
			if (base.exitCode !== 0 || base.timedOut || !(await hasBase()))
				throw unreachable(base.output);
		}
		return ref;
	} catch (error) {
		await deleteFactoryRef(cwd, ref);
		throw error;
	}
}

/**
 * Removes a pull request review's checkout, its branch and the folder
 * Factory keeps beside it. A review never writes to its checkout, so the
 * removal is forced. Does nothing for any other workspace, or one already
 * removed; best effort otherwise.
 */
export async function removeFactoryReviewWorkspace(input: {
	sourceRoot: string;
	workspace: FactoryWorkspace;
}): Promise<void> {
	const { workspace } = input;
	const root = path.dirname(workspace.path);
	if (
		workspace.baseSource !== "pull_request" ||
		path.basename(workspace.path) !== "repo" ||
		path.basename(path.dirname(root)) !== "factory-worktrees" ||
		!FACTORY_BRANCH.test(workspace.branch)
	)
		return;
	try {
		await stat(root);
	} catch {
		return;
	}
	const run = (args: string[]) =>
		runFactoryReviewGit({ cwd: input.sourceRoot, args, timeoutMs: 120_000 });
	await run(["worktree", "remove", "--force", workspace.path]);
	await run(["branch", "-D", workspace.branch]);
	await rm(root, { recursive: true, force: true });
}

export async function assertFactoryCandidate(input: {
	workspace: FactoryWorkspace;
	candidateCommit: string;
	signal?: AbortSignal;
}): Promise<void> {
	await assertOwnedWorkspace(input.workspace, input.signal);
	const head = await git({
		cwd: input.workspace.path,
		args: ["rev-parse", "HEAD"],
		signal: input.signal,
	});
	const status = await git({
		cwd: input.workspace.path,
		args: ["status", "--porcelain", "--untracked-files=all"],
		signal: input.signal,
	});
	if (head !== input.candidateCommit || status)
		throw new Error(
			"Candidate changed after verification began. Commit the changes and rerun checks and review. Keep generated evidence in a gitignored directory.",
		);
}

/**
 * Discards tracked changes and untracked, non-ignored files in an owned
 * worktree, for a worktree that was clean before Factory's own commands
 * dirtied it. With `commit`, also moves the branch back to it (a command
 * that committed).
 */
export async function restoreFactoryWorktree(
	workspace: FactoryWorkspace,
	signal: AbortSignal,
	commit = "HEAD",
): Promise<void> {
	await assertOwnedWorkspace(workspace, signal);
	for (const args of [
		["reset", "--hard", "--quiet", commit],
		["clean", "-fd", "--quiet"],
	])
		await runFactoryCommand({
			cwd: workspace.path,
			file: "git",
			args,
			signal,
			timeoutMs: 60_000,
		});
}

/** Porcelain status of tracked changes and untracked, non-ignored files; empty when clean. */
export async function factoryWorkspaceChanges(
	workspace: FactoryWorkspace,
	signal?: AbortSignal,
): Promise<string> {
	return git({
		cwd: workspace.path,
		args: ["status", "--porcelain", "--untracked-files=all"],
		signal,
	});
}

export async function checkpointFactoryWorkspace(input: {
	workspace: FactoryWorkspace;
	signal?: AbortSignal;
	includeChangedPaths?: boolean;
	/** Commit subject; the card's title when the caller has it. */
	message?: string;
}): Promise<{ candidateCommit: string; diff: string; changedPaths: string[] }> {
	await assertOwnedWorkspace(input.workspace, input.signal);
	const options = { cwd: input.workspace.path, signal: input.signal };
	await git({ ...options, args: ["add", "--all"] });
	const staged = await git({
		...options,
		args: ["diff", "--cached", "--name-only"],
	});
	if (staged)
		await git({
			...options,
			args: ["commit", "-m", input.message ?? "Implement feature task"],
		});
	const candidateCommit = await git({
		...options,
		args: ["rev-parse", "HEAD"],
	});
	await assertFactoryCandidate({ ...input, candidateCommit });
	const diff = await git({
		...options,
		args: [
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--binary",
			input.workspace.baseCommit,
			candidateCommit,
		],
		maxBytes: FACTORY_DIFF_BYTES,
	});
	if (!diff) throw new Error("The feature task produced no changes to review.");
	const changedPaths = input.includeChangedPaths
		? (
				await git({
					...options,
					args: [
						"diff",
						"--name-only",
						"--no-renames",
						"-z",
						input.workspace.baseCommit,
						candidateCommit,
					],
				})
			)
				.split("\0")
				.filter(Boolean)
		: [];
	return { candidateCommit, diff, changedPaths };
}

export async function integrateFactoryCommit(input: {
	workspace: FactoryWorkspace;
	commit: string;
	hasRecordedConflictRepair?: boolean;
	signal?: AbortSignal;
}): Promise<"merged" | "conflicted"> {
	await assertOwnedWorkspace(input.workspace, input.signal);
	const options = { cwd: input.workspace.path, signal: input.signal };
	const pending = async () => {
		const result = await runFactoryCommand({
			...options,
			file: "git",
			args: ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
		});
		if (result.exitCode === 1) return false;
		if (result.exitCode !== 0 || result.output.trim() !== input.commit)
			throw new Error(
				"Unexpected pending integration; inspect the owned workspace",
			);
		return true;
	};
	const contained = await runFactoryCommand({
		...options,
		file: "git",
		args: ["merge-base", "--is-ancestor", input.commit, "HEAD"],
	});
	if (contained.exitCode === 0) return "merged";
	if (contained.exitCode !== 1)
		throw new Error("Could not inspect implementation unit integration");
	const conflicted = async () =>
		Boolean(await git({ ...options, args: ["ls-files", "--unmerged"] }));
	if (await pending()) {
		if (input.hasRecordedConflictRepair || (await conflicted()))
			return "conflicted";
		throw new Error(
			"Pending integration has no recorded conflict repair or unmerged files; inspect the failed merge and repository hooks",
		);
	}
	const status = await git({
		...options,
		args: ["status", "--porcelain", "--untracked-files=all"],
	});
	if (status)
		throw new Error(
			"Implementation integration requires a clean owned workspace",
		);

	const merged = await runFactoryCommand({
		...options,
		file: "git",
		args: ["merge", "--no-edit", input.commit],
	});
	if (merged.exitCode === 0) return "merged";
	if ((await pending()) && (await conflicted())) return "conflicted";
	throw new Error(`Implementation integration failed: ${merged.output}`);
}

export async function finishFactoryIntegration(input: {
	workspace: FactoryWorkspace;
	signal?: AbortSignal;
}): Promise<boolean> {
	for (const args of [
		["diff", "--check"],
		["diff", "--cached", "--check"],
	]) {
		const check = await runFactoryCommand({
			cwd: input.workspace.path,
			file: "git",
			args,
			signal: input.signal,
		});
		if (check.exitCode !== 0) return false;
	}
	await checkpointFactoryWorkspace(input);
	return true;
}

function mimeType(extension: string): string | undefined {
	switch (extension.toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		default:
			return undefined;
	}
}

async function artifactVersion(file: string): Promise<string | undefined> {
	try {
		const metadata = await stat(file, { bigint: true });
		return `${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.size}`;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return undefined;
		throw error;
	}
}

/** Thrown when a declared evidence path resolves outside the task worktree. */
export class FactoryEvidenceOutsideWorktreeError extends Error {
	constructor() {
		super("Evidence must be inside the task worktree.");
		this.name = "FactoryEvidenceOutsideWorktreeError";
	}
}

/** Whether a file's leading bytes match its media type. */
async function hasMediaHeader(source: string, mime: string): Promise<boolean> {
	const file = await open(source, "r");
	try {
		const header = Buffer.alloc(12);
		await file.read(header, 0, header.length, 0);
		return mime === "image/png"
			? header
					.subarray(0, 8)
					.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			: mime === "image/jpeg"
				? header[0] === 255 && header[1] === 216 && header[2] === 255
				: mime === "image/webp"
					? header.toString("ascii", 0, 4) === "RIFF" &&
						header.toString("ascii", 8, 12) === "WEBP"
					: mime === "video/mp4"
						? header.toString("ascii", 4, 8) === "ftyp"
						: header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
	} finally {
		await file.close();
	}
}

/** Copies one media file that must be inside `root` into Factory's artifact store. */
async function collectArtifact(input: {
	declaredPath: string;
	root: string;
	artifactDir: string;
	previousVersion: string | undefined;
}): Promise<FactoryArtifact> {
	const root = await realpath(input.root);
	const source = await realpath(path.resolve(root, input.declaredPath));
	const relative = path.relative(root, source);
	if (
		!relative ||
		relative.startsWith(`..${path.sep}`) ||
		relative === ".." ||
		path.isAbsolute(relative)
	)
		throw new FactoryEvidenceOutsideWorktreeError();
	const metadata = await stat(source);
	const mime = mimeType(path.extname(source));
	if (
		!metadata.isFile() ||
		!mime ||
		metadata.size === 0 ||
		metadata.size > 50 * 1024 * 1024
	)
		throw new Error(
			"Evidence must be a nonempty PNG, JPEG, WebP, MP4, or WebM file no larger than 50 MB.",
		);
	if ((await artifactVersion(source)) === input.previousVersion)
		throw new Error(
			`Evidence was not refreshed by this check: ${input.declaredPath}`,
		);
	if (!(await hasMediaHeader(source, mime)))
		throw new Error(
			`Evidence content does not match its media type: ${input.declaredPath}`,
		);
	await mkdir(input.artifactDir, { recursive: true });
	const destination = path.join(
		input.artifactDir,
		`${randomUUID()}${path.extname(source)}`,
	);
	await copyFile(source, destination);
	return {
		label: input.declaredPath,
		path: destination,
		mimeType: mime,
		bytes: metadata.size,
	};
}

function isMissingFile(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

export async function captureFactoryArtifactVersions(
	cwd: string,
	declaredPaths: string[],
): Promise<Array<string | undefined>> {
	return Promise.all(
		declaredPaths.map((file) => artifactVersion(path.resolve(cwd, file))),
	);
}

export async function collectFactoryArtifacts(input: {
	cwd: string;
	declaredPaths: string[];
	previousVersions: Array<string | undefined>;
	storageDir: string;
	runId: string;
}): Promise<FactoryArtifact[]> {
	const artifacts: FactoryArtifact[] = [];
	for (const [index, declaredPath] of input.declaredPaths.entries()) {
		artifacts.push(
			await collectArtifact({
				declaredPath,
				root: input.cwd,
				previousVersion: input.previousVersions[index],
				artifactDir: path.join(
					input.storageDir,
					"factory-artifacts",
					key(input.runId),
				),
			}),
		);
	}
	return artifacts;
}

const MAX_THUMBNAIL_BYTES = 200 * 1024;

/**
 * Stores the tester's browser capture beside other evidence, with the same
 * containment, size and content checks. A thumbnail goes beside its artifact
 * as `<uuid>.thumb.jpg` and is omitted when invalid or over 200 KB. A file
 * that cannot be stored is skipped and reported in `note`.
 */
export async function collectFactoryCapture(input: {
	dir: string;
	files: FactoryCaptureFile[];
	storageDir: string;
	runId: string;
}): Promise<{ artifacts: FactoryArtifact[]; note?: string }> {
	const artifactDir = path.join(
		input.storageDir,
		"factory-artifacts",
		key(input.runId),
	);
	const artifacts: FactoryArtifact[] = [];
	let failed = 0;
	for (const capture of input.files) {
		try {
			const artifact = await collectArtifact({
				declaredPath: path.relative(input.dir, capture.file),
				root: input.dir,
				artifactDir,
				previousVersion: undefined,
			});
			let thumbnailPath: string | undefined;
			if (capture.thumbnail) {
				const destination = artifact.path.replace(/\.[^.]+$/, ".thumb.jpg");
				thumbnailPath = await stat(capture.thumbnail)
					.then(async (metadata) =>
						metadata.isFile() &&
						metadata.size > 0 &&
						metadata.size <= MAX_THUMBNAIL_BYTES &&
						path.dirname(capture.thumbnail as string) === input.dir &&
						(await hasMediaHeader(capture.thumbnail as string, "image/jpeg"))
							? copyFile(capture.thumbnail as string, destination).then(
									() => destination,
								)
							: undefined,
					)
					.catch(() => undefined);
			}
			artifacts.push({
				...artifact,
				label: capture.caption,
				caption: capture.caption,
				...(thumbnailPath ? { thumbnailPath } : {}),
				...(capture.atMs !== undefined ? { atMs: capture.atMs } : {}),
				...(capture.durationMs !== undefined
					? { durationMs: capture.durationMs }
					: {}),
				...(capture.steps ? { steps: capture.steps.slice(0, 40) } : {}),
			});
		} catch {
			failed += 1;
		}
	}
	return {
		artifacts,
		...(failed
			? {
					note: `${failed} of the tester's captures could not be saved.`,
				}
			: {}),
	};
}

/** Runs one shell command line in `cwd` (`/bin/sh -c`, or `cmd.exe /c` on Windows). */
export function runFactoryShellCommand(
	input: Omit<Parameters<typeof runFactoryCommand>[0], "file" | "args"> & {
		command: string;
	},
): ReturnType<typeof runFactoryCommand> {
	const { command, ...rest } = input;
	return runFactoryCommand({
		...rest,
		file: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
		args:
			process.platform === "win32"
				? ["/d", "/s", "/c", command]
				: ["-c", command],
	});
}

export async function verifyFactoryChecks(input: {
	checks: FactoryCheck[];
	workspace: FactoryWorkspace;
	candidateCommit: string;
	storageDir: string;
	runId: string;
	signal: AbortSignal;
	timeoutMs?: number;
}): Promise<FactoryCheckResult[]> {
	const results: FactoryCheckResult[] = [];
	for (const check of input.checks) {
		await assertFactoryCandidate(input);
		const result: FactoryCheckResult = {
			name: check.name,
			kind: check.kind,
			command: check.command,
			status: "blocked",
			exitCode: null,
			output: "",
			artifacts: [],
		};
		results.push(result);
		if (check.kind === "ui" && check.artifacts.length === 0) {
			result.output =
				"UI checks require declared screenshot or recording paths.";
			continue;
		}
		const previousVersions = await captureFactoryArtifactVersions(
			input.workspace.path,
			check.artifacts,
		);
		const run = await runFactoryShellCommand({
			cwd: input.workspace.path,
			command: check.command,
			signal: input.signal,
			timeoutMs: input.timeoutMs ?? CHECK_TIMEOUT_MS,
		});
		result.exitCode = run.exitCode;
		result.output =
			run.output +
			(run.truncated ? "\n[output truncated]" : "") +
			(run.timedOut ? "\nCheck timed out." : "");
		result.status = run.exitCode === 0 && !run.timedOut ? "passed" : "failed";
		await assertFactoryCandidate(input);
		if (result.status === "passed" && check.kind !== "ui") {
			// A passing test or API check is proven by its exit code and output;
			// evidence it could not capture is noted, never read from outside.
			for (const [index, declaredPath] of check.artifacts.entries()) {
				try {
					result.artifacts.push(
						...(await collectFactoryArtifacts({
							cwd: input.workspace.path,
							declaredPaths: [declaredPath],
							previousVersions: [previousVersions[index]],
							storageDir: input.storageDir,
							runId: input.runId,
						})),
					);
				} catch (error) {
					const reason =
						error instanceof FactoryEvidenceOutsideWorktreeError
							? "outside the task worktree"
							: isMissingFile(error)
								? "missing"
								: error instanceof Error
									? error.message
									: String(error);
					result.limitations = [
						...(result.limitations ?? []),
						`artifact not captured: ${declaredPath}: ${reason}`,
					];
				}
			}
		} else if (result.status === "passed") {
			try {
				result.artifacts = await collectFactoryArtifacts({
					cwd: input.workspace.path,
					declaredPaths: check.artifacts,
					previousVersions,
					storageDir: input.storageDir,
					runId: input.runId,
				});
			} catch (error) {
				result.status = "blocked";
				// UI evidence outside the worktree is a plan defect, not a code one.
				if (error instanceof FactoryEvidenceOutsideWorktreeError)
					result.blockedBy = "configuration";
				result.output += `\n${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}
	return results;
}

/** First line of a command's output, bounded, for a one-line reason. */
function firstLine(output: string, limit = 300): string {
	const line =
		output
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.find(Boolean) ?? "no output";
	return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Failures worth retrying unchanged: the network or GitHub being busy. */
const TRANSIENT_PUBLISH_FAILURE =
	/rate limit|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|network|could not resolve host|connection (?:reset|refused)|HTTP 5\d\d|\b50[234]\b/i;

/** The GitHub repository a Factory PR lives in, as gh's `--repo` names it. */
export type FactoryGitHubRepository = {
	host: string;
	owner: string;
	name: string;
	/** `owner/name` on github.com, `host/owner/name` elsewhere. */
	repo: string;
};

function githubRepository(identity: {
	host: string;
	owner: string;
	name: string;
}): FactoryGitHubRepository {
	return {
		...identity,
		repo: `${identity.host === "github.com" ? "" : `${identity.host}/`}${identity.owner}/${identity.name}`,
	};
}

const sameGitHubRepository = (
	a: FactoryGitHubRepository,
	b: FactoryGitHubRepository,
) => a.repo.toLowerCase() === b.repo.toLowerCase();

/**
 * The GitHub repository `origin` points at, which every gh call about the
 * card's PR names with `--repo`: gh's own choice can be the upstream parent
 * when origin is a fork, while Factory pushes to origin. Reads the URL with
 * `insteadOf` rewrites applied, else as configured. Throws a one-sentence
 * `FactoryPublishError` when there is no origin or it is not a GitHub
 * repository.
 */
export async function factoryOriginRepository(
	input: { cwd: string; signal?: AbortSignal },
	run: typeof runFactoryCommand = runFactoryCommand,
): Promise<FactoryGitHubRepository> {
	const read = (args: string[]) =>
		run({
			cwd: input.cwd,
			file: "git",
			args,
			signal: input.signal,
			captureStdout: true,
		});
	const url = await read(["remote", "get-url", "origin"]);
	if (url.exitCode !== 0)
		throw new FactoryPublishError(
			"This project has no origin remote; add the GitHub remote as origin, or choose Deliver on a branch.",
		);
	let identity = parseFactoryGitHubRemote(url.stdout ?? url.output);
	if (!identity) {
		const configured = await read(["config", "--get", "remote.origin.url"]);
		if (configured.exitCode === 0)
			identity = parseFactoryGitHubRemote(
				configured.stdout ?? configured.output,
			);
	}
	if (!identity)
		throw new FactoryPublishError(
			"This project's origin remote is not a GitHub repository; set origin to the GitHub repository the draft PR belongs to, or choose Deliver on a branch.",
		);
	return githubRepository(identity);
}

/** The repository and number of a GitHub pull request URL. */
export function factoryPullRequestReference(
	url: string,
): { repository: FactoryGitHubRepository; number: number } | undefined {
	const match =
		/^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d{0,9})\/?$/.exec(
			url.trim(),
		);
	const [, host, owner, name, number] = match ?? [];
	if (!host || !owner || !name || !number) return undefined;
	return {
		repository: githubRepository({ host: host.toLowerCase(), owner, name }),
		number: Number(number),
	};
}

/** Stops a card whose draft PR a person closed, before anything is pushed again. */
export const FACTORY_CLOSED_PULL_REQUEST =
	"The draft PR was closed. Reopen it or start a new card.";
/** Stops a card whose draft PR was merged, before anything is pushed again. */
export const FACTORY_MERGED_PULL_REQUEST =
	"The draft PR was merged. Start a new card for further changes.";

/** How long the check before a paid session waits for each gh command. */
export const FACTORY_PULL_REQUEST_CHECK_TIMEOUT_MS = 5_000;

/**
 * The one-sentence stop when gh is not installed or not signed in to
 * `host`. Undefined when it is, and when gh did not answer in time or could
 * not be run: that is not known, and the gh calls that follow decide.
 */
async function githubCliStop(input: {
	cwd: string;
	host: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<FactoryPublishError | undefined> {
	const gh = async (args: string[]) => {
		try {
			return await runFactoryCommand({ ...input, file: "gh", args });
		} catch (error) {
			input.signal?.throwIfAborted();
			return (error as NodeJS.ErrnoException).code === "ENOENT"
				? "missing"
				: undefined;
		}
	};
	const version = await gh(["--version"]);
	if (!version || (version !== "missing" && version.timedOut)) return undefined;
	if (version === "missing" || version.exitCode !== 0)
		return new FactoryPublishError(
			"The GitHub CLI (gh) is not installed; install it from https://cli.github.com, or choose Deliver on a branch.",
		);
	const auth = await gh(["auth", "status", "--hostname", input.host]);
	if (!auth || auth === "missing" || auth.timedOut) return undefined;
	// gh also fails here when it cannot reach GitHub (offline, an expired
	// token it could not refresh): only its own "not logged in" answer is a
	// sign-in the person must make; anything else is left to the publish step.
	return auth.exitCode === 0 || !/not logged in/i.test(auth.output)
		? undefined
		: new FactoryPublishError(
				`The GitHub CLI is not signed in to ${input.host}; run gh auth login (Factory settings → Connections shows when it is ready), or choose Deliver on a branch.`,
			);
}

/**
 * Whether a card that opens a PR can, from local facts and before any paid
 * session: its project's origin is a GitHub repository and gh is installed
 * and signed in to its host, the checks the publish step makes, with each gh
 * command bounded by FACTORY_PULL_REQUEST_CHECK_TIMEOUT_MS. Resolves to the
 * publish step's `FactoryPublishError`, or undefined when it can or gh did
 * not answer (the publish step decides, as before). Undefined, without
 * waiting, for a card that opens no PR (a PR review opens none). Writes
 * nothing; nothing is fetched or pushed.
 */
export function factoryPullRequestStop(
	task: Pick<AgendaTaskRecord, "factory" | "workspaceRoot">,
	signal?: AbortSignal,
): Promise<FactoryPublishError | undefined> | undefined {
	const cwd = task.workspaceRoot;
	if (
		!cwd ||
		!task.factory?.publishPullRequest ||
		factoryDeliverable(task.factory) === "pr_review"
	)
		return undefined;
	return factoryOriginRepository({ cwd, signal })
		.then((repository) =>
			githubCliStop({
				cwd,
				host: repository.host,
				signal,
				timeoutMs: FACTORY_PULL_REQUEST_CHECK_TIMEOUT_MS,
			}),
		)
		.catch((error: unknown) => {
			signal?.throwIfAborted();
			return error instanceof FactoryPublishError ? error : undefined;
		});
}

/**
 * The branch a Factory PR targets, checked before anything is pushed. The
 * card's base branch when `origin` has it; otherwise the remote default
 * branch when it already contains the card's base commit (the local branch
 * has nothing unpublished). Never pushes the base for the user. Throws a
 * `FactoryPublishError` with a one-sentence fix when a person must act: no
 * `origin` or one that is not on GitHub, `gh` missing or signed out, origin
 * needing a prompt to sign in, or an unpublished base branch.
 */
export async function resolveFactoryPullRequestBase(input: {
	workspace: FactoryWorkspace;
	signal?: AbortSignal;
}): Promise<string> {
	const cwd = input.workspace.path;
	const base = input.workspace.baseBranch;
	const run = async (file: string, args: string[]) => {
		try {
			return await runFactoryCommand({
				cwd,
				file,
				args,
				signal: input.signal,
			});
		} catch (error) {
			input.signal?.throwIfAborted();
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	};
	const repository = await factoryOriginRepository({
		cwd,
		signal: input.signal,
	});
	const cli = await githubCliStop({
		cwd,
		host: repository.host,
		signal: input.signal,
	});
	if (cli) throw cli;
	const unreachable = (output: string) =>
		new Error(`Could not reach origin to check the base branch: ${output}`);
	const listed = await run("git", [
		"ls-remote",
		"origin",
		`refs/heads/${base}`,
	]);
	if (!listed || listed.exitCode !== 0 || listed.timedOut)
		throw originFailure(
			listed?.output ?? "",
			unreachable(firstLine(listed?.output ?? "")),
		);
	if (
		listed.output
			.split("\n")
			.some((line) => line.trim().split(/\s+/)[1] === `refs/heads/${base}`)
	)
		return base;
	const unpublished = new FactoryPublishError(
		`The base branch ${base} is not on GitHub and has unpublished commits. Push it, or start this work from a published branch.`,
	);
	const head = await run("git", ["ls-remote", "--symref", "origin", "HEAD"]);
	const fallback = head?.output.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1];
	if (!fallback || fallback === base) throw unpublished;
	const failure = new Error(`Could not fetch ${fallback} from origin.`);
	const tip = await originBranchTip({
		cwd,
		branch: fallback,
		unreachable: failure,
		signal: input.signal,
	});
	if (!tip) throw unpublished;
	const ref = await fetchFactoryBaseCommit({
		cwd,
		branch: fallback,
		commit: tip,
		unreachable: failure,
		signal: input.signal,
	});
	try {
		const contained = await run("git", [
			"merge-base",
			"--is-ancestor",
			input.workspace.baseCommit,
			tip,
		]);
		if (contained?.exitCode !== 0) throw unpublished;
		return fallback;
	} finally {
		await deleteFactoryRef(cwd, ref);
	}
}

const pullRequestListSchema = z.array(
	z.object({
		url: z.string().url(),
		number: z.number().int().positive(),
		state: z.enum(["OPEN", "CLOSED", "MERGED"]),
		headRefOid: z.string(),
		baseRefName: z.string(),
	}),
);

export async function publishFactoryPullRequest(input: {
	workspace: FactoryWorkspace;
	candidateCommit: string;
	title: string;
	body: string;
	/** The resolved PR base; resolved here, before pushing, when absent. */
	baseBranch?: string;
	/**
	 * The card's PR recorded by an earlier publication. It is looked up by
	 * number in any state first: a closed or merged PR stops the card with
	 * a `FactoryDecisionError` and nothing is pushed.
	 */
	pullRequestUrl?: string;
	signal?: AbortSignal;
}): Promise<string> {
	await assertFactoryCandidate(input);
	const cwd = input.workspace.path;
	const base = input.baseBranch ?? (await resolveFactoryPullRequestBase(input));
	const repository = await factoryOriginRepository({
		cwd,
		signal: input.signal,
	});
	const gh = (args: string[]) =>
		runFactoryCommand({
			cwd,
			file: "gh",
			args: [...args, "--repo", repository.repo],
			signal: input.signal,
			captureStdout: true,
		});
	/** Every PR, in any state, whose head is the card's branch. */
	const pullRequests = async () => {
		const result = await gh([
			"pr",
			"list",
			"--state",
			"all",
			"--head",
			input.workspace.branch,
			"--json",
			"url,number,state,headRefOid,baseRefName",
		]);
		if (result.exitCode !== 0 || result.timedOut || result.truncated)
			throw new Error("Could not check for an existing feature PR.");
		return pullRequestListSchema.parse(
			JSON.parse(result.stdout ?? result.output),
		);
	};
	const stopIfEnded = (state: string) => {
		if (state === "CLOSED")
			throw new FactoryDecisionError(FACTORY_CLOSED_PULL_REQUEST);
		if (state === "MERGED")
			throw new FactoryDecisionError(FACTORY_MERGED_PULL_REQUEST);
	};
	if (input.pullRequestUrl) {
		const recorded = factoryPullRequestReference(input.pullRequestUrl);
		if (!recorded || !sameGitHubRepository(recorded.repository, repository))
			throw new FactoryDecisionError(
				"The card's draft PR is not in origin's GitHub repository. Point origin back at that repository, or start a new card.",
			);
		const view = await gh([
			"pr",
			"view",
			String(recorded.number),
			"--json",
			"state,headRefName",
		]);
		if (view.exitCode !== 0 || view.timedOut || view.truncated)
			throw new Error(
				`Could not look up the card's draft PR: ${firstLine(view.output)}`,
			);
		const pr = z
			.object({
				state: z.enum(["OPEN", "CLOSED", "MERGED"]),
				headRefName: z.string(),
			})
			.parse(JSON.parse(view.stdout ?? view.output));
		stopIfEnded(pr.state);
		if (pr.headRefName !== input.workspace.branch)
			throw new FactoryDecisionError(
				"The card's draft PR no longer uses the card's branch. Review it, then start a new card.",
			);
	} else {
		// No PR recorded, yet the card's branch has PRs and none is open: a
		// person closed (or merged) it, so it is not replaced with a new one.
		const existing = await pullRequests();
		const ended = existing.find((entry) => entry.state !== "OPEN");
		if (ended && !existing.some((entry) => entry.state === "OPEN"))
			stopIfEnded(ended.state);
	}
	const open = async () =>
		(await pullRequests()).find(
			(entry) =>
				entry.state === "OPEN" &&
				entry.baseRefName === base &&
				entry.headRefOid === input.candidateCommit,
		)?.url;
	// The candidate is checked again right before it leaves the machine.
	await assertFactoryCandidate(input);
	const pushed = await runFactoryCommand({
		cwd,
		file: "git",
		args: [
			"push",
			"origin",
			`${input.candidateCommit}:refs/heads/${input.workspace.branch}`,
		],
		signal: input.signal,
	});
	if (pushed.exitCode !== 0 || pushed.timedOut)
		throw originFailure(
			pushed.output,
			pushed.timedOut || TRANSIENT_PUBLISH_FAILURE.test(pushed.output)
				? new Error(
						`${FACTORY_PUBLISH_FAILURE_PREFIX}${pushed.timedOut ? "git push timed out" : firstLine(pushed.output)}`,
					)
				: new Error(`Git push failed: ${pushed.output}`),
		);
	await assertFactoryCandidate(input);
	const prior = await open();
	if (prior) return prior;
	const temp = await mkdtemp(path.join(tmpdir(), "cline-factory-pr-"));
	try {
		const bodyFile = path.join(temp, "body.txt");
		await writeFile(bodyFile, input.body);
		const creation = await gh([
			"pr",
			"create",
			"--draft",
			"--head",
			input.workspace.branch,
			"--base",
			base,
			"--title",
			input.title,
			"--body-file",
			bodyFile,
		]);
		const created = await open();
		// An ambiguous failure may still have created the PR; only a missing
		// PR reports gh's own reason.
		if (!created && (creation.exitCode !== 0 || creation.timedOut)) {
			const reason = creation.timedOut
				? "gh pr create timed out"
				: firstLine(creation.output);
			throw creation.timedOut || TRANSIENT_PUBLISH_FAILURE.test(creation.output)
				? new Error(`${FACTORY_PUBLISH_FAILURE_PREFIX}${reason}`)
				: new FactoryPublishError(reason);
		}
		if (!created)
			throw new Error(
				"Could not confirm the draft PR. Retry to reconcile publication before creating another.",
			);
		return created;
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

/**
 * Rewrites the Factory evidence section of an existing PR description,
 * preserving the rest of the description. gh is pointed at the PR's own
 * repository with `--repo`.
 */
export async function updateFactoryPullRequestBody(
	input: {
		workspace: FactoryWorkspace;
		url: string;
		section: string;
		signal?: AbortSignal;
	},
	run: typeof runFactoryCommand = runFactoryCommand,
): Promise<void> {
	const cwd = input.workspace.path;
	const reference = factoryPullRequestReference(input.url);
	if (!reference)
		throw new Error("Updating a PR description requires a pull request URL.");
	const target = [
		String(reference.number),
		"--repo",
		reference.repository.repo,
	];
	const view = await run({
		cwd,
		file: "gh",
		args: ["pr", "view", ...target, "--json", "body"],
		signal: input.signal,
		maxBytes: 1024 * 1024,
		captureStdout: true,
	});
	if (view.exitCode !== 0 || view.timedOut || view.truncated)
		throw new Error(`Could not read the PR description: ${view.output}`);
	// gh notices go to stderr; only stdout is the JSON document.
	const { body } = z
		.object({ body: z.string() })
		.parse(JSON.parse(view.stdout ?? view.output));
	const next = replaceFactoryEvidenceSection(body, input.section);
	if (next === body) return;
	const temp = await mkdtemp(path.join(tmpdir(), "cline-factory-pr-body-"));
	try {
		const bodyFile = path.join(temp, "body.md");
		await writeFile(bodyFile, next);
		const edit = await run({
			cwd,
			file: "gh",
			args: ["pr", "edit", ...target, "--body-file", bodyFile],
			signal: input.signal,
		});
		if (edit.exitCode !== 0 || edit.timedOut)
			throw new Error(`Could not update the PR description: ${edit.output}`);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

/**
 * Marks a draft PR ready for review (`gh pr ready`). Only a PR that is still
 * a draft is changed: one a person already marked ready, or that is no longer
 * open, is left alone. Returns whether this call marked it ready. Never
 * merges.
 */
export async function markFactoryPullRequestReady(
	input: { workspace: FactoryWorkspace; url: string; signal?: AbortSignal },
	run: typeof runFactoryCommand = runFactoryCommand,
): Promise<boolean> {
	const cwd = input.workspace.path;
	const reference = factoryPullRequestReference(input.url);
	if (!reference)
		throw new Error("Marking a PR ready requires a pull request URL.");
	const target = [
		String(reference.number),
		"--repo",
		reference.repository.repo,
	];
	const view = await run({
		cwd,
		file: "gh",
		args: ["pr", "view", ...target, "--json", "state,isDraft"],
		signal: input.signal,
		captureStdout: true,
	});
	if (view.exitCode !== 0 || view.timedOut || view.truncated)
		throw new Error(`Could not read the PR: ${firstLine(view.output)}`);
	const pr = z
		.object({ state: z.string(), isDraft: z.boolean() })
		.parse(JSON.parse(view.stdout ?? view.output));
	if (pr.state !== "OPEN" || !pr.isDraft) return false;
	const ready = await run({
		cwd,
		file: "gh",
		args: ["pr", "ready", ...target],
		signal: input.signal,
	});
	if (ready.exitCode !== 0 || ready.timedOut)
		throw new Error(`Could not mark the PR ready: ${firstLine(ready.output)}`);
	return true;
}

/** Where GitHub looks for a repository's single PR template. */

const PULL_REQUEST_TEMPLATE =
	/^(?:\.github\/|docs\/)?pull_request_template\.md$/i;
const CONTEXT_BYTES = 256 * 1024;

/**
 * What a Factory PR description reads from the repository: origin's GitHub
 * repository, the PR template at the card's base commit, and the files the
 * candidate changes. Best effort: a part that cannot be read is absent.
 */
export async function readFactoryPullRequestContext(
	input: {
		workspace: FactoryWorkspace;
		candidateCommit: string;
		signal?: AbortSignal;
	},
	run: typeof runFactoryCommand = runFactoryCommand,
): Promise<FactoryPullRequestContext> {
	const cwd = input.workspace.path;
	const base = input.workspace.baseCommit;
	const read = (args: string[], maxBytes = CONTEXT_BYTES) =>
		run({
			cwd,
			file: "git",
			args,
			signal: input.signal,
			maxBytes,
			captureStdout: true,
		}).then(
			(result) =>
				result.exitCode === 0 && !result.timedOut ? result : undefined,
			() => undefined,
		);
	const [repository, numstat, tree] = await Promise.all([
		factoryOriginRepository({ cwd, signal: input.signal }, run).then(
			(origin) => origin.repo,
			() => undefined,
		),
		read([
			"diff",
			"--numstat",
			"--no-renames",
			"-z",
			base,
			input.candidateCommit,
		]),
		read(["ls-tree", "--name-only", base, "--", ".", ".github/", "docs/"]),
	]);
	const context: FactoryPullRequestContext = {};
	if (repository) context.repository = repository;
	if (numstat) {
		const entries = (numstat.stdout ?? numstat.output).split("\0");
		// A cut-short listing ends in a partial entry.
		if (numstat.truncated) entries.pop();
		context.changedFiles = entries.flatMap((entry): FactoryChangedFile[] => {
			const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry);
			if (!match?.[3]) return [];
			return [
				match[1] === "-" || match[2] === "-"
					? { path: match[3] }
					: {
							path: match[3],
							added: Number(match[1]),
							removed: Number(match[2]),
						},
			];
		});
		if (numstat.truncated) context.changedFilesIncomplete = true;
	}
	const names = (tree?.stdout ?? tree?.output ?? "")
		.split("\n")
		.map((name) => name.trim())
		.filter((name) => PULL_REQUEST_TEMPLATE.test(name));
	// GitHub's order: .github/, the root, then docs/.
	const path =
		names.find((name) => name.startsWith(".github/")) ??
		names.find((name) => !name.includes("/")) ??
		names[0];
	if (path) {
		const template = await read(["show", `${base}:${path}`], 64 * 1024);
		if (template && !template.truncated)
			context.template = template.stdout ?? template.output;
	}
	return context;
}
