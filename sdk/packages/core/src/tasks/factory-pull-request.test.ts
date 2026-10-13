import { describe, expect, it, vi } from "vitest";
import type { runFactoryCommand } from "./factory-local";
import { readFactoryPullRequest } from "./factory-pull-request";

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
	expect(run).toHaveBeenCalledTimes(2);
});

describe("PR snapshot boundaries", () => {
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
