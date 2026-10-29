import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeGitHubRemoteUrl } from "./git-preflight";

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
	} = {},
) {
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = execFile(
				"git",
				args,
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
		throw new Error(`Git ${args[0]} ${failure}.`);
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
	let published = knownHeads.includes(headSha);
	if (!published && knownHeads.length) {
		try {
			const env = { GIT_NO_LAZY_FETCH: "1" };
			const objects = (
				await git(
					root,
					["cat-file", "--batch-check=%(objectname) %(objecttype)"],
					{
						input: `${knownHeads.join("\n")}\n`,
						env,
					},
				)
			).split("\n");
			const localHeads = knownHeads.filter(
				(sha, i) => objects[i] === `${sha} commit`,
			);
			if (localHeads.length)
				published =
					(await git(root, ["rev-list", "--count", "--stdin"], {
						input: `${[headSha, ...localHeads.map((sha) => `^${sha}`)].join("\n")}\n`,
						env,
					})) === "0";
		} catch {
			// Missing local history must fall through to fetching and validating it.
		}
	}
	if (!published) {
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
	// Snapshot commits use the captured tree without checkout, commit hooks, or signing.
	const commit =
		plan.treeSha ===
		(await git(plan.root, ["rev-parse", `${plan.headSha}^{tree}`]))
			? plan.headSha
			: await git(plan.root, [
					"commit-tree",
					"-p",
					plan.headSha,
					"--no-gpg-sign",
					"-m",
					"Cline cloud handoff checkpoint",
					plan.treeSha,
				]);
	try {
		// Publish only the approved commit, never a moving HEAD or configured push refspecs.
		await git(
			plan.root,
			[
				"-c",
				"push.followTags=false",
				"-c",
				"push.recurseSubmodules=no",
				"push",
				pushUrl,
				`${commit}:refs/heads/${plan.branch}`,
			],
			{ timeout: 10 * 60_000 },
		);
	} catch {
		throw new Error(
			`Couldn't complete the push. Check GitHub write access, branch rules (including required signatures), pre-push hooks, and your connection. Check whether ${plan.branch} was published before retrying.`,
		);
	}
	return commit;
}
