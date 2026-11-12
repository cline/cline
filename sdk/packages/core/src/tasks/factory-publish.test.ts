import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryAgents,
	FactoryReviewSelection,
	FactoryRunState,
	FactoryTaskConfig,
	FactoryWorkspace,
} from "@cline/shared";
import {
	factoryTaskConfigSchema,
	selectFactoryReviewAgents,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaTaskRuntime } from "./agenda-task-manager";
import { FactoryDecisionError, FactoryPublishError } from "./factory-errors";
import {
	checkpointFactoryWorkspace,
	FACTORY_CLOSED_PULL_REQUEST,
	FACTORY_MERGED_PULL_REQUEST,
	prepareFactoryWorkspace,
	publishFactoryPullRequest,
	resolveFactoryPullRequestBase,
	updateFactoryPullRequestBody,
} from "./factory-local";
import { runFactoryWorkflow } from "./factory-workflow";

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
	(await exec("git", args, { cwd })).stdout.trim();

let root: string;
let sourceRoot: string;
let originPath: string;
let ghLog: string;
let prDatabase: string;

type FakePullRequest = {
	number: number;
	repo: string;
	url: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	headRefName: string;
	baseRefName: string;
	body?: string;
};

/**
 * A fake gh over the bare origin. Without `--repo` it acts on `fallbackRepo`,
 * the upstream parent gh itself would pick for a fork checkout.
 */
async function installFakeGh(options: {
	fallbackRepo: string;
	createError?: string;
}) {
	const bin = path.join(root, "bin");
	await mkdir(bin, { recursive: true });
	await writeFile(
		path.join(bin, "gh"),
		`#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const repo = opt("--repo") ?? ${JSON.stringify(options.fallbackRepo)};
const db = ${JSON.stringify(prDatabase)};
const prs = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, "utf8")) : [];
const save = () => fs.writeFileSync(db, JSON.stringify(prs));
const oid = (branch) => { try { return execFileSync("git", ["--git-dir", ${JSON.stringify(originPath)}, "rev-parse", "refs/heads/" + branch], { encoding: "utf8" }).trim(); } catch { return ""; } };
const out = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === "--version" || args[0] === "auth") {}
else if (args[1] === "list") {
  const state = (opt("--state") ?? "open").toUpperCase();
  out(prs.filter((p) => p.repo === repo && p.headRefName === opt("--head") && (state === "ALL" || p.state === state))
    .map((p) => ({ url: p.url, number: p.number, state: p.state, baseRefName: p.baseRefName, headRefOid: oid(p.headRefName) })));
} else if (args[1] === "create") {
  const error = ${JSON.stringify(options.createError ?? "")};
  if (error) { process.stderr.write(error + "\\n"); process.exitCode = 1; }
  else {
    const number = prs.length + 1;
    const url = (repo.split("/").length === 3 ? "https://" : "https://github.com/") + repo + "/pull/" + number;
    prs.push({ number, repo, url, state: "OPEN", headRefName: opt("--head"), baseRefName: opt("--base") });
    save();
  }
} else if (args[1] === "view" || args[1] === "edit") {
  const pr = prs.find((p) => p.repo === repo && String(p.number) === args[2]);
  if (!pr) { process.stderr.write("no pull requests found\\n"); process.exitCode = 1; }
  else if (args[1] === "view") out({ state: pr.state, headRefName: pr.headRefName, body: pr.body ?? "Human summary." });
  else { pr.body = fs.readFileSync(opt("--body-file"), "utf8"); save(); }
} else process.exitCode = 2;
`,
	);
	await chmod(path.join(bin, "gh"), 0o755);
	vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
}

const ghCalls = async () =>
	existsSync(ghLog)
		? (await readFile(ghLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[])
		: [];
const pullRequests = async () =>
	existsSync(prDatabase)
		? (JSON.parse(await readFile(prDatabase, "utf8")) as FakePullRequest[])
		: [];
const setPullRequestState = async (
	number: number,
	state: FakePullRequest["state"],
) =>
	writeFile(
		prDatabase,
		JSON.stringify(
			(await pullRequests()).map((pr) =>
				pr.number === number ? { ...pr, state } : pr,
			),
		),
	);
/** Branches origin has under refs/heads/factory and refs/heads/feat. */
const remoteBranches = async () =>
	(
		await git(
			originPath,
			"for-each-ref",
			"--format=%(refname) %(objectname)",
			"refs/heads/factory",
			"refs/heads/feat",
		)
	)
		.split("\n")
		.filter(Boolean);

/** Points origin at `https://github.com/<repo>.git`, served by the bare origin. */
async function githubOrigin(repo: string, remote = "origin") {
	const url = `https://github.com/${repo}.git`;
	await git(sourceRoot, "remote", "add", remote, url);
	await git(sourceRoot, "config", `url.${originPath}.insteadOf`, url);
}

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "factory-publish-test-"));
	sourceRoot = path.join(root, "source");
	originPath = path.join(root, "origin.git");
	ghLog = path.join(root, "gh-calls.jsonl");
	prDatabase = path.join(root, "prs.json");
	await mkdir(sourceRoot);
	await git(sourceRoot, "init", "-q", "-b", "main");
	await git(sourceRoot, "config", "user.email", "factory@example.test");
	await git(sourceRoot, "config", "user.name", "Factory Test");
	await writeFile(path.join(sourceRoot, "feature.txt"), "before\n");
	await writeFile(path.join(sourceRoot, ".gitignore"), ".evidence/\n");
	await git(sourceRoot, "add", ".");
	await git(sourceRoot, "commit", "-q", "-m", "Initial");
	await git(root, "init", "-q", "--bare", "-b", "main", originPath);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

async function candidate(taskId = "publish-card", content = "after\n") {
	const workspace = await prepareFactoryWorkspace({
		sourceRoot,
		storageDir: path.join(root, "storage"),
		taskId,
		publish: true,
	});
	await writeFile(path.join(workspace.path, "feature.txt"), content);
	const { candidateCommit } = await checkpointFactoryWorkspace({ workspace });
	return { workspace, candidateCommit };
}

async function nextCandidate(workspace: FactoryWorkspace, content: string) {
	await writeFile(path.join(workspace.path, "feature.txt"), content);
	return (await checkpointFactoryWorkspace({ workspace })).candidateCommit;
}

describe.skipIf(process.platform === "win32")("draft PR publication", () => {
	const publication = (
		input: Awaited<ReturnType<typeof candidate>>,
		pullRequestUrl?: string,
	) => ({
		...input,
		title: "Feature",
		body: "Synthetic verification evidence.",
		pullRequestUrl,
	});

	it("names origin's repository with --repo on every gh call about the PR", async () => {
		await githubOrigin("example/project");
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "somebody/else" });
		const input = await candidate();
		const url = await publishFactoryPullRequest(publication(input));
		expect(url).toBe("https://github.com/example/project/pull/1");
		await updateFactoryPullRequestBody({
			workspace: input.workspace,
			url,
			section:
				"<!-- cline-factory-evidence:start -->\nVerified\n<!-- cline-factory-evidence:end -->",
		});
		// A second publication of a later candidate reuses the recorded PR.
		const later = await nextCandidate(input.workspace, "after again\n");
		expect(
			await publishFactoryPullRequest(
				publication({ ...input, candidateCommit: later }, url),
			),
		).toBe(url);
		const calls = await ghCalls();
		const prCalls = calls.filter((args) => args[0] === "pr");
		expect(prCalls.map((args) => args[1])).toEqual(
			expect.arrayContaining(["list", "create", "view", "edit"]),
		);
		for (const args of prCalls)
			expect(
				args.slice(args.indexOf("--repo"), args.indexOf("--repo") + 2),
				args.join(" "),
			).toEqual(["--repo", "example/project"]);
		expect(calls).toContainEqual([
			"auth",
			"status",
			"--hostname",
			"github.com",
		]);
		expect(await pullRequests()).toHaveLength(1);
		expect(await remoteBranches()).toEqual([
			`refs/heads/${input.workspace.branch} ${later}`,
		]);
	});

	it("opens the PR in a fork origin's repository, not its upstream parent", async () => {
		await githubOrigin("fork-owner/project");
		await git(
			sourceRoot,
			"remote",
			"add",
			"upstream",
			"https://github.com/upstream-owner/project.git",
		);
		// gh's own default for a fork checkout.
		await git(sourceRoot, "config", "remote.upstream.gh-resolved", "base");
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "upstream-owner/project" });
		const input = await candidate();
		expect(await publishFactoryPullRequest(publication(input))).toBe(
			"https://github.com/fork-owner/project/pull/1",
		);
		expect(
			(await pullRequests()).map((pr) => [pr.repo, pr.headRefName]),
		).toEqual([["fork-owner/project", input.workspace.branch]]);
		for (const args of (await ghCalls()).filter((call) => call[0] === "pr"))
			expect(args).toContain("fork-owner/project");
	});

	it("names a GitHub Enterprise origin by host", async () => {
		const url = "git@github.example.com:team/project.git";
		await git(sourceRoot, "remote", "add", "origin", url);
		await git(sourceRoot, "config", `url.${originPath}.insteadOf`, url);
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "somebody/else" });
		const input = await candidate();
		await expect(publishFactoryPullRequest(publication(input))).resolves.toBe(
			"https://github.example.com/team/project/pull/1",
		);
		const calls = await ghCalls();
		expect(calls).toContainEqual([
			"auth",
			"status",
			"--hostname",
			"github.example.com",
		]);
		for (const args of calls.filter((call) => call[0] === "pr"))
			expect(args).toContain("github.example.com/team/project");
	});

	it("stops before pushing when origin is not a GitHub repository", async () => {
		await git(sourceRoot, "remote", "add", "origin", originPath);
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "upstream-owner/project" });
		const input = await candidate();
		const failure = publishFactoryPullRequest(publication(input));
		await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
		await expect(failure).rejects.toThrow(
			"This project's origin remote is not a GitHub repository; set origin to the GitHub repository the draft PR belongs to, or turn off draft PRs for this card.",
		);
		await expect(
			resolveFactoryPullRequestBase({ workspace: input.workspace }),
		).rejects.toBeInstanceOf(FactoryPublishError);
		expect(await remoteBranches()).toEqual([]);
		expect((await ghCalls()).filter((call) => call[0] === "pr")).toEqual([]);
	});

	it.each([
		["CLOSED", FACTORY_CLOSED_PULL_REQUEST],
		["MERGED", FACTORY_MERGED_PULL_REQUEST],
	] as const)("does not replace a recorded PR that is %s and pushes nothing more", async (state, message) => {
		await githubOrigin("example/project");
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "example/project" });
		const input = await candidate();
		const url = await publishFactoryPullRequest(publication(input));
		await setPullRequestState(1, state);
		const later = await nextCandidate(input.workspace, "after again\n");
		for (const recorded of [url, undefined]) {
			const failure = publishFactoryPullRequest(
				publication({ ...input, candidateCommit: later }, recorded),
			);
			await expect(failure).rejects.toBeInstanceOf(FactoryDecisionError);
			await expect(failure).rejects.not.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow(message);
		}
		expect(await pullRequests()).toHaveLength(1);
		expect(
			(await ghCalls()).filter((call) => call[1] === "create"),
		).toHaveLength(1);
		expect(await remoteBranches()).toEqual([
			`refs/heads/${input.workspace.branch} ${input.candidateCommit}`,
		]);
	});

	it("refuses a recorded PR from another repository than origin", async () => {
		await githubOrigin("example/project");
		await git(sourceRoot, "push", "-q", "origin", "main");
		await installFakeGh({ fallbackRepo: "example/project" });
		const input = await candidate();
		await expect(
			publishFactoryPullRequest(
				publication(input, "https://github.com/upstream-owner/project/pull/1"),
			),
		).rejects.toThrow(
			"The card's draft PR is not in origin's GitHub repository.",
		);
		expect(await remoteBranches()).toEqual([]);
	});
});

/** A Factory run of one card driven directly, with scripted builder and reviewer sessions. */
async function factoryRun(options: {
	/** Reviewer verdict per review session, in order (a reviewer pool runs in parallel). */
	review: (call: number) => {
		verdict: "pass" | "changes_requested";
		findings: string[];
	};
	builder?: (cwd: string, build: number) => Promise<void>;
	maxRepairRounds?: number;
	reviewerPool?: number;
	reviewSelection?: FactoryReviewSelection;
	/** Called as each reviewer session starts. */
	onReview?: () => Promise<void>;
	createError?: string;
}) {
	await githubOrigin("example/project");
	await git(sourceRoot, "push", "-q", "origin", "main");
	await installFakeGh({
		fallbackRepo: "example/project",
		createError: options.createError,
	});
	const workspace = await prepareFactoryWorkspace({
		sourceRoot,
		storageDir: path.join(root, "storage"),
		taskId: "task_workflow",
		publish: true,
		branchName: "factory/f-7-update-feature",
	});
	const pool: FactoryAgents = {
		designer: {},
		planReviewers: [],
		implementers: [{}],
		reviewers: Array.from(
			{ length: options.reviewerPool ?? 1 },
			(_, index) => ({
				instructions: `Reviewer ${index + 1}.`,
			}),
		),
	};
	const agents = selectFactoryReviewAgents(pool, options.reviewSelection);
	const check = {
		name: "Feature behavior",
		kind: "api" as const,
		command: `node -e "if(!require('fs').readFileSync('feature.txt','utf8').startsWith('after'))process.exit(1)"`,
		artifacts: [],
	};
	const config: FactoryTaskConfig = factoryTaskConfigSchema.parse({
		maxRepairRounds: options.maxRepairRounds ?? 1,
		publishPullRequest: true,
		checks: [check],
		acceptanceCriteria: [
			{
				id: "feature-after",
				text: "feature.txt says after",
				check: check.name,
			},
		],
		agents,
		humanStamp: "always",
	});
	const now = new Date().toISOString();
	const task: AgendaTaskRecord = {
		taskId: "task_workflow",
		factoryNumber: 7,
		type: "follow-up",
		status: "in_progress",
		title: "Update feature",
		instructions: "Acceptance: feature.txt says after.",
		scope: "workspace",
		workspaceRoot: sourceRoot,
		cwd: sourceRoot,
		resourcePaths: [],
		priority: 2,
		availableAt: now,
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		automationEligible: false,
		revision: 1,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: now,
		updatedAt: now,
		factory: config,
		...(options.reviewSelection
			? {
					factoryDesignProgress: {
						phase: "complete" as const,
						revision: 1,
						repairRound: 0,
						agents: pool,
						designerSessionId: "designer",
						findings: [],
						reviewSelection: options.reviewSelection,
						reviewerSessions: [],
						reviews: [],
					},
				}
			: {}),
	};
	const run: AgendaTaskRunRecord = {
		runId: "run_workflow",
		taskId: task.taskId,
		taskRevision: 1,
		attempt: 1,
		status: "running",
		claimedAt: now,
		createdAt: now,
		updatedAt: now,
	};
	let state: FactoryRunState = {
		phase: "implementing",
		repairRound: 0,
		workspace,
		sessions: [],
		agents,
		...(options.reviewSelection
			? { reviewSelection: options.reviewSelection }
			: {}),
	};
	const roles = new Map<string, string>();
	let sessions = 0;
	let builds = 0;
	let reviews = 0;
	const runtime: AgendaTaskRuntime = {
		startSession: vi.fn(async (_task, _run, _client, sessionConfig) => {
			const sessionId = sessionConfig?.sessionId ?? `session_${++sessions}`;
			roles.set(sessionId, sessionConfig?.factoryRole ?? "builder");
			return { sessionId };
		}),
		runSession: vi.fn(async (sessionId, assigned) => {
			if (roles.get(sessionId) === "reviewer") {
				await options.onReview?.();
				const { verdict, findings } = options.review(++reviews);
				return {
					status: "completed" as const,
					summary: JSON.stringify({ verdict, findings, summary: "Reviewed." }),
				};
			}
			builds++;
			await writeFile(path.join(assigned.cwd ?? "", "feature.txt"), "after\n");
			await options.builder?.(assigned.cwd ?? "", builds);
			return { status: "completed" as const, summary: "Implemented" };
		}),
		abortSession: vi.fn(async () => {}),
	};
	const execute = () =>
		runFactoryWorkflow({
			task,
			run,
			state,
			runtime,
			storageDir: path.join(root, "storage"),
			signal: new AbortController().signal,
			save: (next) => {
				state = next;
			},
			sessionStarted: () => {},
		});
	return {
		execute,
		state: () => state,
		builds: () => builds,
		reviews: () => reviews,
		workspace,
	};
}

describe.skipIf(process.platform === "win32")(
	"publishing from the Factory workflow",
	() => {
		it("pushes nothing before verification and review pass", async () => {
			const seen: string[][] = [];
			const r = await factoryRun({
				maxRepairRounds: 2,
				review: (call) =>
					call === 1
						? {
								verdict: "changes_requested",
								findings: ["Handle empty input."],
							}
						: { verdict: "pass", findings: [] },
				onReview: async () => {
					seen.push(await remoteBranches());
				},
			});
			const result = await r.execute();
			expect(result.status).toBe("completed");
			expect(seen).toEqual([[], []]);
			const commit = r.state().candidate?.commit;
			expect(await remoteBranches()).toEqual([
				`refs/heads/factory/f-7-update-feature ${commit}`,
			]);
			expect(r.state()).toMatchObject({
				pullRequestUrl: "https://github.com/example/project/pull/1",
				phase: "watching",
			});
		});

		it("never pushes a candidate whose checks fail, even at the repair limit", async () => {
			const r = await factoryRun({
				maxRepairRounds: 0,
				review: () => ({ verdict: "pass", findings: [] }),
				builder: async (cwd) => {
					await writeFile(path.join(cwd, "feature.txt"), "wrong\n");
				},
			});
			await expect(r.execute()).rejects.toThrow("Repair limit (0) reached");
			expect(await remoteBranches()).toEqual([]);
			expect(await pullRequests()).toEqual([]);
		});

		it("keeps the unresolved findings when publishing them fails", async () => {
			const r = await factoryRun({
				maxRepairRounds: 0,
				review: () => ({
					verdict: "changes_requested",
					findings: ["Rename the helper to match the module."],
				}),
				createError:
					"pull request create failed: GraphQL: Base ref must be a branch",
			});
			const failure = r.execute();
			await expect(failure).rejects.toBeInstanceOf(FactoryPublishError);
			await expect(failure).rejects.toThrow("Base ref must be a branch");
			const state = r.state();
			expect(state.unresolvedFindings).toEqual({
				commit: state.candidate?.commit,
				findings: ["Reviewer 1: Rename the helper to match the module."],
			});
			expect(state).toMatchObject({
				phase: "blocked",
				pullRequestError: expect.stringContaining("Base ref must be a branch"),
				error: expect.stringContaining("Base ref must be a branch"),
				humanReview: { required: true },
			});
		});

		it.each([
			"The API token is written to the log.",
			"Possible SQL injection in the query builder.",
			"Hard-coded password in the fixture.",
			"Bundles a dependency with CVE-2024-0001.",
		])("keeps work with a security-sensitive finding local: %s", async (finding) => {
			const r = await factoryRun({
				maxRepairRounds: 0,
				review: () => ({ verdict: "changes_requested", findings: [finding] }),
			});
			const failure = r.execute();
			await expect(failure).rejects.toBeInstanceOf(FactoryDecisionError);
			await expect(failure).rejects.toThrow(
				"Repair limit (0) reached; an unresolved finding may be security-sensitive, so the work stays local and the branch was not pushed.",
			);
			expect(await remoteBranches()).toEqual([]);
			expect((await ghCalls()).filter((call) => call[1] === "create")).toEqual(
				[],
			);
			expect(r.state()).toMatchObject({
				unresolvedFindings: { findings: [`Reviewer 1: ${finding}`] },
				humanReview: {
					required: true,
					reason: "possible security finding kept local",
				},
			});
			expect(r.state().pullRequestUrl).toBeUndefined();
		});

		it("publishes ordinary open findings as a draft PR at the repair limit", async () => {
			const r = await factoryRun({
				maxRepairRounds: 0,
				review: () => ({
					verdict: "changes_requested",
					findings: ["Rename the helper to match the module."],
				}),
			});
			await expect(r.execute()).rejects.toThrow(
				"Repair limit (0) reached; the draft PR stays open with 1 unresolved finding",
			);
			expect(r.state().unresolvedFindings).toMatchObject({
				pullRequestOpen: true,
			});
			expect(await remoteBranches()).toHaveLength(1);
		});

		const selection = (
			size: FactoryReviewSelection["size"],
			reviewerIndices: number[],
		): FactoryReviewSelection => ({
			impact:
				size === "trivial" || size === "local" ? "local" : "shared_contract",
			size,
			rationale: "Rated by the designer.",
			affectedPaths: ["feature.txt", "generated"],
			consumers: ["feature readers"],
			planReviewerIndices: [],
			reviewerIndices,
		});

		it("adds reviewers when a trivial rating's diff is far larger", async () => {
			const r = await factoryRun({
				reviewerPool: 3,
				reviewSelection: selection("trivial", [0]),
				review: () => ({ verdict: "pass", findings: [] }),
				builder: async (cwd) => {
					await mkdir(path.join(cwd, "generated"), { recursive: true });
					for (let index = 0; index < 20; index++)
						await writeFile(
							path.join(cwd, "generated", `file-${index}.txt`),
							`${index}\n`,
						);
				},
			});
			expect((await r.execute()).status).toBe("completed");
			const state = r.state();
			expect(state.reviewEscalation).toMatchObject({
				commit: state.candidate?.commit,
				rationale: expect.stringContaining("reviewed as shared contract"),
			});
			expect(state.reviewEscalation?.affectedPaths).toContain(
				"generated/file-0.txt",
			);
			expect(
				state.agents?.reviewers.map((agent) => agent.instructions),
			).toEqual(["Reviewer 1.", "Reviewer 2."]);
			expect(r.reviews()).toBe(2);
			expect(state.candidate?.reviews).toHaveLength(2);
		});

		it("keeps the escalated reviewers when a repair shrinks the diff", async () => {
			const r = await factoryRun({
				reviewerPool: 3,
				maxRepairRounds: 1,
				reviewSelection: selection("trivial", [0]),
				review: (call) =>
					call <= 2
						? {
								verdict: "changes_requested",
								findings: ["Drop the generated files."],
							}
						: { verdict: "pass", findings: [] },
				builder: async (cwd, build) => {
					await mkdir(path.join(cwd, "generated"), { recursive: true });
					for (let index = 0; index < 20; index++) {
						const file = path.join(cwd, "generated", `file-${index}.txt`);
						if (build === 1) await writeFile(file, `${index}\n`);
						else await rm(file, { force: true });
					}
				},
			});
			expect((await r.execute()).status).toBe("completed");
			expect(r.builds()).toBe(2);
			// Two reviewers in each round: the rating never went back down.
			expect(r.reviews()).toBe(4);
			expect(r.state().agents?.reviewers).toHaveLength(2);
			expect(r.state().reviewEscalation).toBeDefined();
		});

		it("never lowers a larger rating for a small diff", async () => {
			const r = await factoryRun({
				reviewerPool: 3,
				reviewSelection: selection("shared_contract", [0, 1]),
				review: () => ({ verdict: "pass", findings: [] }),
			});
			expect((await r.execute()).status).toBe("completed");
			expect(r.state().reviewEscalation).toBeUndefined();
			expect(r.state().agents?.reviewers).toHaveLength(2);
			expect(r.reviews()).toBe(2);
		});

		it("keeps a trivial rating whose diff stays within its bounds", async () => {
			const r = await factoryRun({
				reviewerPool: 3,
				reviewSelection: selection("trivial", [0]),
				review: () => ({ verdict: "pass", findings: [] }),
			});
			expect((await r.execute()).status).toBe("completed");
			expect(r.state().reviewEscalation).toBeUndefined();
			expect(r.reviews()).toBe(1);
		});
	},
);
