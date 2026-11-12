import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	DEFAULT_FACTORY_AGENTS,
	type FactoryRunState,
	factoryPullRequestReadyAllowed,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgendaTaskRuntime } from "./agenda-task-manager";
import {
	markFactoryPullRequestReady,
	type runFactoryCommand,
} from "./factory-local";
import {
	readFactoryPullRequest,
	runFactoryPullRequestFollowup,
} from "./factory-pull-request";

const connection = <T>(nodes: T[], hasNextPage = false) => ({
	nodes,
	pageInfo: { hasNextPage },
});
const comment = (id: string, body: string) => ({
	id,
	body,
	authorAssociation: "MEMBER",
	author: { __typename: "User" },
	url: `https://github.com/example/project/pull/1#${id}`,
});

it("reads unresolved feedback and failing checks while excluding resolved threads, approvals and its own replies", async () => {
	const run = vi.fn<typeof runFactoryCommand>(async ({ args }) => ({
		exitCode: 0,
		timedOut: false,
		truncated: false,
		output:
			args[0] === "run"
				? "AssertionError: empty input returned 500"
				: JSON.stringify(
						args[0] === "api"
							? {
									data: {
										repository: {
											pullRequest: {
												state: "OPEN",
												headRefOid: "candidate",
												headRefName: "feat/test",
												comments: connection([
													{
														...comment("question", "Please add pagination."),
														authorAssociation: "NONE",
													},
													comment(
														"own",
														"Done <!-- cline-factory-followup:abc -->",
													),
												]),
												reviews: connection([
													{
														...comment("approval", "Approved"),
														state: "APPROVED",
													},
													{
														...comment("review", "Missing edge case"),
														state: "CHANGES_REQUESTED",
													},
												]),
												reviewThreads: connection([
													{
														isResolved: true,
														comments: connection([
															comment("resolved", "Old finding"),
														]),
													},
													{
														isResolved: false,
														comments: connection([
															{
																...comment("thread", "Missing empty input"),
																authorAssociation: "NONE",
																author: { __typename: "Bot" },
															},
														]),
													},
												]),
											},
										},
									},
								}
							: {
									statusCheckRollup: [
										{
											name: "Tests",
											status: "COMPLETED",
											conclusion: "FAILURE",
											detailsUrl:
												"https://github.com/example/project/actions/runs/1",
										},
										{
											name: "Build",
											status: "COMPLETED",
											conclusion: "SUCCESS",
										},
										{ name: "Lint", status: "IN_PROGRESS", conclusion: null },
									],
								},
					),
	}));
	const snapshot = await readFactoryPullRequest(
		{
			url: "https://github.com/example/project/pull/1",
			cwd: "/tmp",
			signal: new AbortController().signal,
		},
		run,
	);
	expect(snapshot.feedback.map((entry) => entry.text)).toEqual([
		"https://github.com/example/project/pull/1#question\nPlease add pagination.",
		"https://github.com/example/project/pull/1#review\nMissing edge case",
		"https://github.com/example/project/pull/1#thread\nMissing empty input",
		"CI check Tests: FAILURE\nhttps://github.com/example/project/actions/runs/1\n\nFAILED JOB LOGS:\nAssertionError: empty input returned 500",
	]);
	expect(run).toHaveBeenCalledWith(
		expect.objectContaining({
			args: ["run", "view", "1", "--repo", "example/project", "--log-failed"],
			maxBytes: 32_768,
		}),
	);
	expect(snapshot.feedback.map((entry) => entry.trusted)).toEqual([
		false,
		true,
		true,
		true,
	]);
	expect(snapshot.feedback[3]?.id).toMatch(/^check:candidate:/);
	expect(snapshot.commentBodies).toContain(
		"Done <!-- cline-factory-followup:abc -->",
	);
	run.mockClear();
	await readFactoryPullRequest(
		{
			url: "https://github.com/example/project/pull/1",
			cwd: "/tmp",
			signal: new AbortController().signal,
			handledFeedbackIds: snapshot.feedback.map((entry) => entry.id),
		},
		run,
	);
	expect(run).toHaveBeenCalledTimes(3);
});

describe("PR snapshot boundaries", () => {
	it.each([
		["pass", "passed"],
		["pending", "pending"],
		["fail", "failed"],
		["skipping", "unknown"],
		["changed-head", "rejected"],
	])("binds required %s checks to the actual PR head", async (bucket, expected) => {
		const run = vi.fn<typeof runFactoryCommand>(async ({ args }) => {
			let payload: unknown;
			if (args[0] === "api")
				payload = {
					data: {
						repository: {
							pullRequest: {
								state: "OPEN",
								headRefOid: "candidate",
								headRefName: "feat/test",
								comments: connection([]),
								reviews: connection([]),
								reviewThreads: connection([]),
							},
						},
					},
				};
			else if (args[1] === "checks")
				payload = [
					{
						name: "Required test",
						bucket: bucket === "changed-head" ? "pass" : bucket,
					},
				];
			else if (args.at(-1) === "headRefOid")
				payload = {
					headRefOid: bucket === "changed-head" ? "new-head" : "candidate",
				};
			else payload = { statusCheckRollup: [] };
			return {
				exitCode: bucket === "pending" && args[1] === "checks" ? 8 : 0,
				timedOut: false,
				truncated: false,
				output: JSON.stringify(payload),
			};
		});
		const read = readFactoryPullRequest(
			{
				url: "https://github.com/example/project/pull/1",
				cwd: "/tmp",
				signal: new AbortController().signal,
			},
			run,
		);
		if (expected === "rejected")
			await expect(read).rejects.toThrow("PR head changed");
		else
			expect((await read).requiredChecks).toMatchObject({
				headCommit: "candidate",
				status: expected,
			});
	});

	it("stops on incomplete feedback instead of silently claiming full coverage", async () => {
		const run = vi.fn<typeof runFactoryCommand>(async () => ({
			exitCode: 0,
			timedOut: false,
			truncated: false,
			output: JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							state: "OPEN",
							headRefOid: "candidate",
							headRefName: "feat/test",
							comments: connection([], true),
							reviews: connection([]),
							reviewThreads: connection([]),
						},
					},
				},
			}),
		}));
		await expect(
			readFactoryPullRequest(
				{
					url: "https://github.com/example/project/pull/1",
					cwd: "/tmp",
					signal: new AbortController().signal,
				},
				run,
			),
		).rejects.toThrow("100 comments");
		expect(run).toHaveBeenCalledTimes(1);
	});
	it("does not query checks after the PR closes", async () => {
		const run = vi.fn<typeof runFactoryCommand>(async () => ({
			exitCode: 0,
			timedOut: false,
			truncated: false,
			output: JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							state: "MERGED",
							headRefOid: "candidate",
							headRefName: "feat/test",
							comments: connection([]),
							reviews: connection([]),
							reviewThreads: connection([]),
						},
					},
				},
			}),
		}));
		expect(
			(
				await readFactoryPullRequest(
					{
						url: "https://github.com/example/project/pull/1",
						cwd: "/tmp",
						signal: new AbortController().signal,
					},
					run,
				)
			).state,
		).toBe("MERGED");
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe("PR outcome", () => {
	const url = "https://github.com/example/project/pull/1";
	const published = "factory-commit";
	// Hands-off defaults: publish the draft PR, read-only watching.
	const task = {
		taskId: "task_a",
		title: "Fix typo",
		instructions: "Fix the typo.",
		factory: factoryTaskConfigSchema.parse({
			approval: "automatic",
			publishPullRequest: true,
			watchPullRequest: false,
		}),
	} as AgendaTaskRecord;
	const watching = factoryRunStateSchema.parse({
		phase: "watching",
		repairRound: 0,
		sessions: [],
		workspace: {
			path: "/wt",
			branch: "factory/fix-typo",
			baseBranch: "main",
			baseCommit: "base",
		},
		pullRequestUrl: url,
		pullRequestWatch: { headCommit: published, handledFeedbackIds: [] },
	});
	/** gh answering for a PR in `state` whose head is `head`. */
	const gh = (state: "OPEN" | "CLOSED" | "MERGED", head = published) =>
		vi.fn<typeof runFactoryCommand>(async ({ args }) => ({
			exitCode: 0,
			timedOut: false,
			truncated: false,
			output: JSON.stringify(
				args[0] === "api"
					? {
							data: {
								repository: {
									pullRequest: {
										state,
										headRefOid: head,
										headRefName: "factory/fix-typo",
										comments: connection([]),
										reviews: connection([]),
										reviewThreads: connection([]),
									},
								},
							},
						}
					: args[1] === "checks"
						? []
						: args.includes("headRefOid")
							? { headRefOid: head }
							: { statusCheckRollup: [] },
			),
		}));
	const follow = async (state: FactoryRunState, run: ReturnType<typeof gh>) => {
		let saved = state;
		const result = await runFactoryPullRequestFollowup(
			{
				task,
				run: { runId: "run_1" } as AgendaTaskRunRecord,
				state,
				runtime: {} as AgendaTaskRuntime,
				storageDir: "/tmp",
				signal: new AbortController().signal,
				save: (updated) => {
					saved = updated;
				},
				sessionStarted: () => {},
			},
			{ run },
		);
		// Read-only: only gh reads; nothing is pushed or posted.
		expect(
			run.mock.calls.every(
				([input]) => input.file === "gh" && input.args[1] !== "comment",
			),
		).toBe(true);
		return { result, state: saved };
	};

	it("records a PR merged as Factory delivered it and stops watching", async () => {
		const { result, state } = await follow(watching, gh("MERGED"));
		expect(result).toBe("closed");
		expect(state).toMatchObject({
			phase: "ready",
			pullRequestOutcome: { state: "merged", headChanged: false },
		});
		expect(state.pullRequestWatch).toBeUndefined();
	});

	it("keeps watching read-only after someone pushes, then records the merge as changed", async () => {
		const open = await follow(watching, gh("OPEN", "human-commit"));
		expect(open.result).toBe("idle");
		expect(open.state.phase).toBe("watching");
		expect(open.state.pullRequestOutcome).toBeUndefined();
		const merged = await follow(open.state, gh("MERGED", "human-commit"));
		expect(merged.state.pullRequestOutcome).toMatchObject({
			state: "merged",
			headChanged: true,
		});
	});

	it("records a PR closed without merging", async () => {
		const { state } = await follow(watching, gh("CLOSED"));
		expect(state.pullRequestOutcome).toMatchObject({
			state: "closed",
			headChanged: false,
		});
		expect(state.pullRequestWatch).toBeUndefined();
	});

	it("records nothing while the PR is open", async () => {
		const { result, state } = await follow(watching, gh("OPEN"));
		expect(result).toBe("idle");
		expect(state.pullRequestOutcome).toBeUndefined();
		expect(state.pullRequestWatch).toEqual(watching.pullRequestWatch);
	});

	it("never polls a run without a PR", async () => {
		const run = gh("MERGED");
		await expect(
			follow(
				{ ...watching, pullRequestUrl: undefined, pullRequestWatch: undefined },
				run,
			),
		).rejects.toThrow("verified pull request");
		expect(run).not.toHaveBeenCalled();
	});
});

describe("marking a draft PR ready", () => {
	const pass = { verdict: "pass" as const, summary: "ok", findings: [] };
	const candidate = {
		commit: "abc",
		checks: [
			{
				name: "Unit tests",
				kind: "test" as const,
				command: "bun test",
				status: "passed" as const,
				exitCode: 0,
				output: "ok",
				artifacts: [],
			},
		],
		reviews: [{ reviewerIndex: 0, sessionId: "r", review: pass }],
		verification: { sessionId: "v", review: pass, artifacts: [] },
	};
	const config = {
		pullRequestReady: "when_no_review_required" as const,
		agents: { ...DEFAULT_FACTORY_AGENTS, verifier: {} },
	};
	const state = {
		candidate,
		humanReview: { required: false, reason: "local change" },
	} as unknown as FactoryRunState;
	const changes = {
		verdict: "changes_requested" as const,
		summary: "no",
		findings: ["Fix it."],
	};

	it("allows only a fully clean delivery that needs no person", () => {
		expect(factoryPullRequestReadyAllowed(config, state, true)).toBe(true);
		const denied: [string, boolean][] = [
			[
				"setting off",
				factoryPullRequestReadyAllowed(
					{ ...config, pullRequestReady: undefined },
					state,
					true,
				),
			],
			[
				"check failed",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						candidate: {
							...candidate,
							checks: [{ ...candidate.checks[0], status: "failed" }],
						},
					} as FactoryRunState,
					true,
				),
			],
			[
				"tester failed",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						candidate: {
							...candidate,
							verification: { ...candidate.verification, review: changes },
						},
					} as FactoryRunState,
					true,
				),
			],
			[
				"tester missing",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						candidate: { ...candidate, verification: undefined },
					} as FactoryRunState,
					true,
				),
			],
			[
				"review not clean",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						candidate: {
							...candidate,
							reviews: [{ ...candidate.reviews[0], review: changes }],
						},
					} as FactoryRunState,
					true,
				),
			],
			["not independent", factoryPullRequestReadyAllowed(config, state, false)],
			[
				"review required",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						humanReview: { required: true, reason: "shared contract" },
					},
					true,
				),
			],
			[
				"open findings",
				factoryPullRequestReadyAllowed(
					config,
					{
						...state,
						unresolvedFindings: { commit: "abc", findings: ["x"] },
					} as FactoryRunState,
					true,
				),
			],
		];
		expect(denied.filter(([, allowed]) => allowed)).toEqual([]);
	});

	it("marks only an open draft ready, and never merges", async () => {
		const views: string[] = [];
		const gh = (view: { state: string; isDraft: boolean }) =>
			vi.fn<typeof runFactoryCommand>(async (input) => {
				views.push(input.args.slice(0, 2).join(" "));
				const stdout = JSON.stringify(view);
				return {
					exitCode: 0,
					output: stdout,
					stdout,
					truncated: false,
					timedOut: false,
				};
			});
		const input = {
			workspace: { path: "/work" } as never,
			url: "https://github.com/example/project/pull/7",
		};
		const draft = gh({ state: "OPEN", isDraft: true });
		expect(await markFactoryPullRequestReady(input, draft)).toBe(true);
		expect(draft.mock.calls.map(([call]) => call.args)).toEqual([
			[
				"pr",
				"view",
				"7",
				"--repo",
				"example/project",
				"--json",
				"state,isDraft",
			],
			["pr", "ready", "7", "--repo", "example/project"],
		]);
		for (const existing of [
			{ state: "OPEN", isDraft: false },
			{ state: "MERGED", isDraft: false },
			{ state: "CLOSED", isDraft: true },
		]) {
			const run = gh(existing);
			expect(await markFactoryPullRequestReady(input, run)).toBe(false);
			expect(run).toHaveBeenCalledTimes(1);
		}
		expect(views.some((args) => /merge/.test(args))).toBe(false);
	});
});
