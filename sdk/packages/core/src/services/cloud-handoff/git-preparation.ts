import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeGitHubRemoteUrl } from "./git-preflight";

const isolatedHookNotice =
	"If a repository hook failed, it ran in an isolated checkout without your local dependencies or generated files.";

export type HandoffGitPlan = {
	id: string;
	root: string;
	workspaceRelativePath: string;
	repoUrl: string;
	remote: string;
	branch: string;
	sourceBranch: string;
	headSha: string;
	treeSha: string;
	files: Array<{ path: string; status: string }>;
	commits: string[];
};

export type HandoffGitPreview = Pick<
	HandoffGitPlan,
	"id" | "repoUrl" | "remote" | "branch" | "sourceBranch" | "files" | "commits"
>;

export type HandoffGitPublication = Omit<
	HandoffGitPlan,
	"sourceBranch" | "files" | "commits"
>;

export function previewHandoffGit(plan: HandoffGitPlan): HandoffGitPreview {
	const { id, repoUrl, remote, branch, sourceBranch, files, commits } = plan;
	return { id, repoUrl, remote, branch, sourceBranch, files, commits };
}

async function git(
	cwd: string,
	args: string[],
	options: {
		env?: Partial<NodeJS.ProcessEnv>;
		timeout?: number;
		input?: string;
		hooksPath?: string;
	} = {},
) {
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = execFile(
				"git",
				options.hooksPath
					? ["-c", `core.hooksPath=${options.hooksPath}`, ...args]
					: args,
				{
					cwd,
					env: {
						...process.env,
						...options.env,
						GIT_TERMINAL_PROMPT: "0",
						// Inspect the physical history that push transfers, not local overlays.
						GIT_NO_REPLACE_OBJECTS: "1",
						GIT_GRAFT_FILE: "/dev/null",
					},
					encoding: "utf8",
					maxBuffer: 8 * 1024 * 1024,
					timeout: options.timeout ?? 60_000,
				},
				(error, stdout) => (error ? reject(error) : resolve(stdout.trimEnd())),
			);
			if (options.input !== undefined) {
				child.stdin?.on("error", reject);
				child.stdin?.end(options.input);
			}
		});
	} catch (error) {
		// Git errors can contain credential-bearing URLs or hook output.
		const code =
			error instanceof Error && "code" in error ? error.code : undefined;
		const timedOut =
			code === null &&
			error instanceof Error &&
			"killed" in error &&
			error.killed === true;
		const failure = timedOut
			? `timed out after ${(options.timeout ?? 60_000) / 1_000} seconds`
			: `failed${typeof code === "number" ? ` (exit code ${code})` : ""}. Check Git authentication, permissions, and repository state`;
		throw new Error(
			`Git ${args[0]} ${failure}.${options.hooksPath ? ` ${isolatedHookNotice}` : ""}`,
		);
	}
}

async function optionalConfig(cwd: string, key: string) {
	try {
		return await git(cwd, ["config", "--get", key]);
	} catch {
		return "";
	}
}

function isSensitivePath(path: string): boolean {
	return (
		/(^|\/)(\.env(?:\.[^/]*)?|\.npmrc|\.yarnrc\.yml|\.netrc|\.pgpass|\.pypirc|\.aws\/credentials|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx|jks|keystore)$/i.test(
			path,
		) && !/\.(example|sample|template)$/i.test(path)
	);
}

async function readPublicationDestination(root: string, remote: string) {
	const fetchUrls = (
		await git(root, ["remote", "get-url", "--all", remote])
	).split("\n");
	const pushUrls = (
		await git(root, ["remote", "get-url", "--push", "--all", remote])
	).split("\n");
	const repoUrl = normalizeGitHubRemoteUrl(fetchUrls[0] ?? "");
	const pushUrl = pushUrls[0];
	if (
		repoUrl &&
		pushUrl &&
		fetchUrls.length === 1 &&
		pushUrls.length === 1 &&
		normalizeGitHubRemoteUrl(pushUrl) === repoUrl
	)
		return { repoUrl, pushUrl };
	return undefined;
}

export async function inspectHandoffGit(
	cwd: string,
	onCaptured?: () => void,
): Promise<HandoffGitPlan> {
	const root = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => {
		throw new Error(
			"Could not read the Git repository. Open a Git repository and check access before using /cloud.",
		);
	});
	const workspaceRelativePath = (
		await git(cwd, ["rev-parse", "--show-prefix"])
	).replace(/\/$/, "");
	if (
		(await git(root, ["ls-files", "-v", "-z"]))
			.split("\0")
			.some((entry) => /^[a-zS] /.test(entry))
	) {
		throw new Error(
			"Cloud preparation cannot include files marked skip-worktree or assume-unchanged. Review these flags and local changes before retrying /cloud.",
		);
	}
	const sourceBranch = await git(root, [
		"symbolic-ref",
		"--short",
		"HEAD",
	]).catch(() => {
		throw new Error(
			"Could not read the current branch. Check out a Git branch before using /cloud.",
		);
	});
	const headSha = await git(root, ["rev-parse", "HEAD"]);
	const status = await git(root, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
		"--ignore-submodules=none",
		"--no-renames",
	]);
	const files = status
		.split("\0")
		.filter(Boolean)
		.map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
	const submodules = (await git(root, ["ls-files", "--stage", "-z"]))
		.split("\0")
		.filter((entry) => entry.startsWith("160000 "))
		.map((entry) => entry.slice(entry.indexOf("\t") + 1));
	if (
		files.some(
			(file) =>
				file.status.includes("U") ||
				["AA", "DD"].includes(file.status) ||
				submodules.includes(file.path),
		)
	) {
		throw new Error(
			"Resolve conflicts or changes inside submodules before continuing in cloud.",
		);
	}
	if (files.some(({ path }) => isSensitivePath(path))) {
		throw new Error(
			"Potentially sensitive files need review before cloud preparation. Keep private files out of the changes and unpublished history before retrying /cloud.",
		);
	}
	const indexTree = await git(root, ["write-tree"]);
	const temporary = await mkdtemp(join(tmpdir(), "cline-handoff-index-"));
	let treeSha: string;
	try {
		const env = { GIT_INDEX_FILE: join(temporary, "index") };
		await git(root, ["read-tree", indexTree], { env });
		await git(root, ["add", "-A", "--", ":/"], { env });
		treeSha = await git(root, ["write-tree"], { env });
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	const candidateSubmodules = (
		await git(root, ["ls-tree", "-r", "-z", treeSha])
	)
		.split("\0")
		.filter((entry) => entry.startsWith("160000 "))
		.map((entry) => entry.slice(entry.indexOf("\t") + 1));
	if (candidateSubmodules.some((path) => !submodules.includes(path)))
		throw new Error(
			"Nested Git repositories cannot be included in automatic cloud preparation. Review them before continuing.",
		);
	if (
		(await git(root, [
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
			"--ignore-submodules=none",
			"--no-renames",
		])) !== status ||
		(await git(root, ["rev-parse", "HEAD"])) !== headSha ||
		(await git(root, ["write-tree"])) !== indexTree
	) {
		throw new Error(
			"The repository changed while preparing the preview. Run /cloud again.",
		);
	}
	onCaptured?.();
	const remote =
		(await optionalConfig(root, `branch.${sourceBranch}.remote`)) || "origin";
	if (remote === "." || remote.startsWith("-"))
		throw new Error("Choose a GitHub remote before continuing in cloud.");
	const destination = await readPublicationDestination(root, remote);
	if (!destination) {
		throw new Error(
			"Cloud preparation requires one GitHub repository shared by the fetch and push destination. Review the remote configuration first.",
		);
	}
	const { repoUrl } = destination;
	const remoteHeads = await git(root, ["ls-remote", "--heads", remote]);
	const knownHeads = remoteHeads
		.split("\n")
		.map((line) => line.split(/\s/)[0] ?? "")
		.filter((sha) => /^[0-9a-f]{40,64}$/.test(sha));
	let commits: string[] = [];
	// An advertised branch at HEAD proves its entire ancestry is already published.
	if (!knownHeads.includes(headSha)) {
		if (knownHeads.length) {
			await git(
				root,
				[
					"fetch",
					"--no-prune",
					"--no-tags",
					"--no-write-fetch-head",
					"--no-recurse-submodules",
					"--refmap=",
					"--stdin",
					remote,
				],
				{ input: `${knownHeads.join("\n")}\n` },
			);
		}
		const input = `${[headSha, ...knownHeads.map((sha) => `^${sha}`)].join("\n")}\n`;
		commits = (await git(root, ["log", "--format=%h %s", "--stdin"], { input }))
			.split("\n")
			.filter(Boolean);
		const historicalPaths = await git(
			root,
			[
				"log",
				"--format=",
				"--name-only",
				"-z",
				"--root",
				"-c",
				"--no-renames",
				"--stdin",
			],
			{ input },
		);
		if (historicalPaths.split("\0").some(isSensitivePath)) {
			throw new Error(
				"Potentially sensitive files exist in unpublished history, even if deleted later. Review that history before retrying /cloud; no branch was created or pushed.",
			);
		}
	}
	return {
		id: randomUUID(),
		root,
		workspaceRelativePath,
		repoUrl,
		remote,
		branch: `cline/handoff-${randomUUID().slice(0, 12)}`,
		sourceBranch,
		headSha,
		treeSha,
		files,
		commits,
	};
}

async function assertPublicationDestination(
	plan: HandoffGitPublication,
): Promise<string> {
	const destination = await readPublicationDestination(plan.root, plan.remote);
	if (!destination || destination.repoUrl !== plan.repoUrl)
		throw new Error(
			"The remote changed after confirmation. Run /cloud again to review the destination.",
		);
	return destination.pushUrl;
}

export async function verifyPublishedHandoffGit(
	plan: HandoffGitPublication,
	headSha: string,
): Promise<void> {
	await assertPublicationDestination(plan);
	const published = await git(plan.root, [
		"ls-remote",
		"--heads",
		plan.remote,
		`refs/heads/${plan.branch}`,
	]);
	if (published.split(/\s/)[0] !== headSha)
		throw new Error(
			"The published branch changed during preparation. Run /cloud again.",
		);
}

export async function applyHandoffGit(
	plan: HandoffGitPublication,
): Promise<string> {
	const pushUrl = await assertPublicationDestination(plan);
	const hooksPath = await git(plan.root, [
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"hooks",
	]);
	if (
		(
			await git(plan.root, [
				"ls-remote",
				"--heads",
				plan.remote,
				`refs/heads/${plan.branch}`,
			])
		).trim()
	) {
		throw new Error(
			"The proposed handoff branch already exists. Run /cloud again.",
		);
	}
	let pushing = false;
	const temporary = await mkdtemp(join(tmpdir(), "cline-handoff-checkout-"));
	const checkout = join(await realpath(temporary), "checkout");
	try {
		await git(plan.root, [
			"worktree",
			"add",
			"-b",
			plan.branch,
			checkout,
			plan.headSha,
		]);
		await git(checkout, ["read-tree", "--reset", "-u", plan.treeSha]);
		if (plan.treeSha !== (await git(checkout, ["rev-parse", "HEAD^{tree}"]))) {
			await git(checkout, ["commit", "-m", "Cline cloud handoff checkpoint"], {
				timeout: 10 * 60_000,
				hooksPath,
			});
		}
		if (
			(await git(checkout, ["rev-parse", "HEAD^{tree}"])) !== plan.treeSha ||
			(await git(checkout, [
				"status",
				"--porcelain=v1",
				"--untracked-files=all",
				"--ignore-submodules=none",
			]))
		) {
			throw new Error(
				"Files changed during preparation; nothing was pushed. Review the working tree before retrying.",
			);
		}
		const commit = await git(checkout, ["rev-parse", "HEAD"]);
		if (
			(await git(checkout, ["symbolic-ref", "--short", "HEAD"])) !==
				plan.branch ||
			(commit !== plan.headSha &&
				(await git(checkout, ["rev-list", "--parents", "-n", "1", commit])) !==
					`${commit} ${plan.headSha}`)
		) {
			throw new Error(
				"The branch or commit history changed during preparation; nothing was pushed.",
			);
		}
		await git(plan.root, [
			"config",
			`branch.${plan.branch}.remote`,
			plan.remote,
		]);
		await git(plan.root, [
			"config",
			`branch.${plan.branch}.merge`,
			`refs/heads/${plan.branch}`,
		]);
		// Publish only the approved commit, never a moving HEAD or configured push refspecs.
		pushing = true;
		await git(
			checkout,
			[
				"-c",
				"push.followTags=false",
				"-c",
				"push.recurseSubmodules=no",
				"push",
				pushUrl,
				`${commit}:refs/heads/${plan.branch}`,
			],
			{ timeout: 10 * 60_000, hooksPath },
		);
		pushing = false;
		return commit;
	} catch (error) {
		if (pushing) {
			throw new Error(
				`Couldn't complete the push. Your checkpoint is saved locally on ${plan.branch}. Check GitHub write access and your connection before retrying. ${isolatedHookNotice}`,
			);
		}
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Your local checkout was not changed. A checkpoint may remain on ${plan.branch}.`,
		);
	} finally {
		// A post-checkout hook can fail after Git has registered the worktree.
		const worktrees = await git(plan.root, [
			"worktree",
			"list",
			"--porcelain",
			"-z",
		]);
		const registered = worktrees
			.split("\0")
			.some(
				(field) =>
					field.startsWith("worktree ") && resolve(field.slice(9)) === checkout,
			);
		if (registered)
			await git(plan.root, ["worktree", "remove", "--force", checkout]);
		await rm(temporary, { recursive: true, force: true });
	}
}
