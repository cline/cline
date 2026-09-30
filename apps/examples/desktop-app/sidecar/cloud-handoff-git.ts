import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { normalizeGitHubRemoteUrl } from "@cline/core";

const exec = promisify(execFile);

export type HandoffGitPlan = {
	id: string;
	root: string;
	cwd: string;
	repoUrl: string;
	pushUrl: string;
	remote: string;
	branch: string;
	sourceBranch: string;
	headSha: string;
	treeSha: string;
	indexTree: string;
	status: string;
	files: Array<{ path: string; status: string }>;
	commits: string[];
};

export type HandoffGitPreview = Pick<
	HandoffGitPlan,
	"id" | "repoUrl" | "remote" | "branch" | "sourceBranch" | "files" | "commits"
>;

export function previewHandoffGit(plan: HandoffGitPlan): HandoffGitPreview {
	const { id, repoUrl, remote, branch, sourceBranch, files, commits } = plan;
	return { id, repoUrl, remote, branch, sourceBranch, files, commits };
}

async function git(
	cwd: string,
	args: string[],
	env?: Partial<NodeJS.ProcessEnv>,
	timeout = 60_000,
) {
	try {
		return (
			await exec("git", args, {
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
				timeout,
			})
		).stdout.trimEnd();
	} catch {
		// Git errors can contain credential-bearing URLs or hook output.
		throw new Error(
			`Git ${args[0]} failed. Check Git authentication, permissions, and repository state.`,
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
		/(^|\/)(\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx)$/i.test(
			path,
		) && !/\.(example|sample|template)$/i.test(path)
	);
}

export async function inspectHandoffGit(cwd: string): Promise<HandoffGitPlan> {
	const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
	if (
		(await git(root, ["ls-files", "-v", "-z"]))
			.split("\0")
			.some((entry) => /^[a-zS] /.test(entry))
	) {
		throw new Error(
			"Cloud preparation cannot include files marked skip-worktree or assume-unchanged. Review these flags and local changes before retrying /cloud.",
		);
	}
	const sourceBranch = await git(root, ["symbolic-ref", "--short", "HEAD"]);
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
	const remote =
		(await optionalConfig(root, `branch.${sourceBranch}.remote`)) || "origin";
	if (remote === "." || remote.startsWith("-"))
		throw new Error("Choose a GitHub remote before continuing in cloud.");
	const fetchUrls = (
		await git(root, ["remote", "get-url", "--all", remote])
	).split("\n");
	const pushUrls = (
		await git(root, ["remote", "get-url", "--push", "--all", remote])
	).split("\n");
	const repoUrl = normalizeGitHubRemoteUrl(fetchUrls[0] ?? "");
	const pushUrl = pushUrls[0];
	if (
		!repoUrl ||
		!pushUrl ||
		fetchUrls.length !== 1 ||
		pushUrls.length !== 1 ||
		normalizeGitHubRemoteUrl(pushUrls[0] ?? "") !== repoUrl
	) {
		throw new Error(
			"Cloud preparation requires one GitHub repository shared by the fetch and push destination. Review the remote configuration first.",
		);
	}
	const remoteHeads = await git(root, ["ls-remote", "--heads", remote]);
	const knownHeads = remoteHeads
		.split("\n")
		.map((line) => line.split(/\s/)[0] ?? "")
		.filter((sha) => /^[0-9a-f]{40,64}$/.test(sha));
	const unpublishedRange = [
		headSha,
		...(knownHeads.length ? ["--not", ...knownHeads] : []),
	];
	const commits = (
		await git(root, [
			"log",
			"--ignore-missing",
			"--format=%h %s",
			...unpublishedRange,
		])
	)
		.split("\n")
		.filter(Boolean);
	const historicalPaths = await git(root, [
		"log",
		"--ignore-missing",
		"--format=",
		"--name-only",
		"-z",
		"--root",
		"-m",
		"--no-renames",
		...unpublishedRange,
	]);
	if (historicalPaths.split("\0").some(isSensitivePath)) {
		throw new Error(
			"Potentially sensitive files exist in unpublished history, even if deleted later. Review that history before retrying /cloud; no branch was created or pushed.",
		);
	}
	const indexTree = await git(root, ["write-tree"]);
	const temporary = await mkdtemp(join(tmpdir(), "cline-handoff-index-"));
	let treeSha: string;
	try {
		const env = { GIT_INDEX_FILE: join(temporary, "index") };
		await git(root, ["read-tree", indexTree], env);
		await git(root, ["add", "-A", "--", ":/"], env);
		treeSha = await git(root, ["write-tree"], env);
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
	return {
		id: randomUUID(),
		root,
		cwd: resolve(cwd),
		repoUrl,
		pushUrl,
		remote,
		branch: `cline/handoff-${randomUUID().slice(0, 12)}`,
		sourceBranch,
		headSha,
		treeSha,
		indexTree,
		status,
		files,
		commits,
	};
}

export async function applyHandoffGit(plan: HandoffGitPlan): Promise<void> {
	const current = await inspectHandoffGit(plan.root);
	for (const key of [
		"root",
		"repoUrl",
		"pushUrl",
		"remote",
		"sourceBranch",
		"headSha",
		"treeSha",
		"indexTree",
		"status",
	] as const) {
		if (current[key] !== plan[key])
			throw new Error(
				"The repository changed after confirmation. Run /cloud again to review the updated changes.",
			);
	}
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
	try {
		await git(plan.root, ["switch", "-c", plan.branch]);
		await git(plan.root, ["read-tree", plan.treeSha]);
		if (plan.treeSha !== (await git(plan.root, ["rev-parse", "HEAD^{tree}"]))) {
			await git(
				plan.root,
				["commit", "-m", "Cline cloud handoff checkpoint"],
				undefined,
				10 * 60_000,
			);
		}
		if (
			(await git(plan.root, ["rev-parse", "HEAD^{tree}"])) !== plan.treeSha ||
			(await git(plan.root, [
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
		const commit = await git(plan.root, ["rev-parse", "HEAD"]);
		if (
			(await git(plan.root, ["symbolic-ref", "--short", "HEAD"])) !==
				plan.branch ||
			(commit !== plan.headSha &&
				(await git(plan.root, ["rev-list", "--parents", "-n", "1", commit])) !==
					`${commit} ${plan.headSha}`)
		) {
			throw new Error(
				"The branch or commit history changed during preparation; nothing was pushed.",
			);
		}
		// Publish only the approved commit, never a moving HEAD or configured push refspecs.
		pushing = true;
		await git(
			plan.root,
			[
				"-c",
				"push.followTags=false",
				"-c",
				"push.recurseSubmodules=no",
				"push",
				plan.pushUrl,
				`${commit}:refs/heads/${plan.branch}`,
			],
			undefined,
			10 * 60_000,
		);
		pushing = false;
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
	} catch (error) {
		if (pushing) {
			throw new Error(
				`Couldn't complete the push. Your checkpoint is saved locally on ${plan.branch}. Check GitHub write access and your connection before retrying.`,
			);
		}
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} Preparation may have left a checkpoint on ${plan.branch}; your files were not rolled back. Inspect that branch before retrying.`,
		);
	}
}
