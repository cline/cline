import type {
	SessionReplayDivergenceReport,
	SessionReplayRerunReport,
} from "@cline/session";
import { describe, expect, it } from "vitest";
import {
	defaultRerunOutDir,
	formatRerunProgress,
	formatSessionRerunText,
	recordedQuestionAnswers,
	rerunToolPolicies,
} from "./rerun";
import {
	buildContainerRerunCommand,
	CONTAINER_PATHS,
	containerEnv,
	innerRerunArgs,
} from "./rerun-container";

function comparison(
	overrides: Partial<SessionReplayDivergenceReport> = {},
): SessionReplayDivergenceReport {
	return {
		strictness: "strict",
		kinds: ["tool-calls", "tool-results", "iteration-count"],
		iterations: { recorded: 2, live: 2 },
		perIteration: [
			{ iteration: 1, kinds: [], counted: false },
			{ iteration: 2, kinds: [], counted: false },
		],
		divergences: [],
		first: null,
		diverged: false,
		failed: false,
		warnings: [],
		...overrides,
	} as SessionReplayDivergenceReport;
}

function report(
	overrides: Partial<SessionReplayRerunReport> = {},
): SessionReplayRerunReport {
	return {
		format: "cline.session-replay-rerun-report",
		version: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		recorded: { bundleDir: "/b/bundle", sessionId: "sess_rec" },
		live: {
			sessionId: "sess_live",
			bundleDir: "/b/bundle.rerun/bundle",
			validated: true,
		},
		workspace: {
			method: "checkpoint",
			source: "/src/app",
			root: "/b/bundle.rerun/workspace/app",
			cwd: "/b/bundle.rerun/workspace/app",
			checkpoint: { ref: "0123456789abcdef", kind: "stash", base: "fedcba" },
		},
		env: { applied: false, changed: [], unknown: [] },
		options: {
			kinds: ["tool-calls", "tool-results", "iteration-count"],
			requestMatching: "strict",
			untilDivergence: false,
			interactive: false,
			provider: "openai-compatible",
			model: "fake-model",
			recordedProvider: "openai-compatible",
			recordedModel: "fake-model",
		},
		turns: { recorded: 1, sent: 1 },
		stopped: null,
		finishReason: "completed",
		comparison: comparison(),
		matches: [],
		approvals: [],
		gaps: ["no container image (the bundle schema has no image digest)"],
		warnings: [],
		...overrides,
	};
}

describe("rerun helpers", () => {
	it("writes next to the bundle by default", () => {
		expect(
			defaultRerunOutDir(
				"/tmp/x/bug-123",
				new Date("2026-03-04T05:06:07.890Z"),
			),
		).toBe("/tmp/x/bug-123.rerun-20260304T050607Z");
	});

	it("uses recorded tool policies unless missing or redacted", () => {
		expect(
			rerunToolPolicies({
				toolPolicies: { run_commands: { autoApprove: false } },
			}),
		).toEqual({
			policies: { run_commands: { autoApprove: false } },
			recorded: true,
		});
		expect(rerunToolPolicies({})).toEqual({
			policies: { "*": { autoApprove: true } },
			recorded: false,
		});
		expect(
			rerunToolPolicies({ toolPolicies: { "*": "[REDACTED]" } }).recorded,
		).toBe(false);
	});

	it("collects recorded ask_question answers in order", () => {
		expect(
			recordedQuestionAnswers([
				{
					toolCalls: [
						{ id: "q1", name: "ask_question" },
						{ id: "r1", name: "read_files" },
					],
					toolResults: [
						{ toolCallId: "r1", content: "file", text: "file" },
						{ toolCallId: "q1", content: "Use yarn", text: "Use yarn" },
					],
				},
				{
					toolCalls: [{ id: "q2", name: "ask_question" }],
					toolResults: [
						{ toolCallId: "q2", content: [{ type: "text" }], text: "Yes" },
					],
				},
			]),
		).toEqual(["Use yarn", "Yes"]);
	});

	it("formats progress lines", () => {
		expect(
			formatRerunProgress({ type: "turn", turn: 1, of: 2, iteration: 1 }),
		).toBe("turn 1/2 (recorded iteration 1)");
		expect(
			formatRerunProgress({
				type: "iteration",
				iteration: 2,
				divergences: [],
				counted: false,
			}),
		).toBe("iteration 2  same");
		expect(
			formatRerunProgress({
				type: "approval",
				approval: {
					iteration: 1,
					toolName: "run_commands",
					toolCallId: "c1",
					approved: true,
					source: "recording",
					recordedSeq: 7,
				},
			}),
		).toBe("approval run_commands: approved (recorded #7)");
		expect(
			formatRerunProgress({ type: "iteration-started", iteration: 1 }),
		).toBe(undefined);
	});

	it("formats a report with no divergence", () => {
		const lines = formatSessionRerunText({
			report: report(),
			reportPath: "/b/bundle.rerun/rerun-report.json",
		});
		expect(lines).toContain(
			"  workspace: checkpoint 0123456789ab (stash) restored into /b/bundle.rerun/workspace/app, a fresh clone of /src/app",
		);
		expect(lines).toContain("  model:     fake-model (openai-compatible)");
		expect(lines).toContain("Result: no divergence across 2 iterations");
		expect(lines).toContain(
			"  - no container image (the bundle schema has no image digest)",
		);
		expect(lines.at(-1)).toBe(
			"Compare: cline session diff /b/bundle /b/bundle.rerun/bundle",
		);
	});

	it("formats a stopped rerun with a model override", () => {
		const divergence = {
			kind: "tool-calls" as const,
			iteration: 2,
			counted: true,
			summary: "tool calls differ",
			entries: [],
		};
		const lines = formatSessionRerunText({
			report: report({
				options: {
					...report().options,
					untilDivergence: true,
					requestMatching: "relaxed",
					model: "other-model",
				},
				stopped: {
					reason: "until-divergence",
					iteration: 2,
					kind: "tool-calls",
				},
				comparison: comparison({
					perIteration: [
						{ iteration: 1, kinds: [], counted: false },
						{ iteration: 2, kinds: ["tool-calls"], counted: true },
					],
					divergences: [divergence],
					first: divergence,
					diverged: true,
					failed: true,
				}),
			}),
			reportPath: "/r.json",
		});
		expect(lines).toContain(
			"  model:     other-model (openai-compatible), recorded with fake-model (openai-compatible)",
		);
		expect(lines).toContain(
			"  stopped:   at iteration 2 (tool-calls), --until-divergence",
		);
		expect(lines).toContain("  iteration 2  tool-calls");
		expect(lines).toContain(
			"Result: diverged · 1 counted divergence in 1 iteration",
		);
	});
});

describe("container rerun", () => {
	it("applies the recorded env except host-only and redacted keys", () => {
		expect(
			containerEnv({
				env: {
					values: {
						PATH: "/usr/bin",
						LANG: "C.UTF-8",
						HOME: "/root",
						TOKEN: "[REDACTED]",
					},
					sha256: "x",
					redactedKeys: ["TOKEN"],
				},
			}),
		).toEqual({
			applied: { LANG: "C.UTF-8", HOME: "/root" },
			skipped: ["PATH", "TOKEN"],
		});
	});

	it("mounts the workspace at the recorded path and runs the rerun in place", () => {
		const { runtime, args } = buildContainerRerunCommand({
			runtime: "docker",
			image: "node:22",
			cli: "bun /src/cli.ts",
			runtimeArgs: ["--volume=/src:/src:ro"],
			recordedRoot: "/work/app",
			recordedCwd: "/work/app/pkg",
			workspaceRoot: "/host/out/workspace/app",
			bundleDir: "/host/bundle",
			containerOutDir: "/host/out/container",
			providersPath: "/host/providers.json",
			env: { LANG: "C.UTF-8" },
			passEnv: ["ANTHROPIC_API_KEY"],
			hubPort: 4567,
			user: "1000:1000",
			rerunArgs: ["--until-divergence"],
		});
		expect(runtime).toBe("docker");
		const joined = args.join(" ");
		expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
		expect(joined).toContain("--network host --user 1000:1000");
		expect(joined).toContain(`--tmpfs ${CONTAINER_PATHS.home}:rw,mode=1777`);
		expect(joined).toContain("-v /host/out/workspace/app:/work/app");
		expect(joined).toContain(`-v /host/bundle:${CONTAINER_PATHS.bundle}:ro`);
		expect(joined).toContain(`-v /host/out/container:${CONTAINER_PATHS.out}`);
		expect(joined).toContain(
			`-v /host/providers.json:${CONTAINER_PATHS.providers}:ro`,
		);
		expect(joined).toContain("-e LANG=C.UTF-8");
		expect(joined).toContain(`-e HOME=${CONTAINER_PATHS.home}`);
		expect(joined).toContain("-e CLINE_HUB_PORT=4567");
		expect(joined).toContain("-e ANTHROPIC_API_KEY ");
		expect(joined).toContain(
			"-w /work/app/pkg --volume=/src:/src:ro node:22 bun /src/cli.ts session replay /cline-replay/bundle --mode rerun --in-place --workspace /work/app --out /cline-replay/out --format json --until-divergence",
		);
	});

	it("forwards rerun flags to the rerun in the container", () => {
		expect(
			innerRerunArgs({
				bundleDir: "/b",
				ignore: "request",
				count: "assistant-text",
				lenient: true,
				model: "m",
			}),
		).toEqual([
			"--continue",
			"--ignore",
			"request",
			"--count",
			"assistant-text",
			"--lenient",
			"--model",
			"m",
		]);
	});
});
