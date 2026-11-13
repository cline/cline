import { describe, expect, it } from "vitest";
import {
	applyFactoryAutonomyDefaults,
	applyFactoryReviewSizePolicy,
	applyFactoryVerificationProfile,
	DEFAULT_FACTORY_AGENTS,
	evaluateFactoryAcceptance,
	FACTORY_BUILT_IN_POLICY,
	FACTORY_MAX_AGENT_RETRIES,
	FACTORY_MAX_INTERRUPT_RECOVERIES,
	FACTORY_MAX_PLAN_FAULT_REDESIGNS,
	FACTORY_SPENDING_LIMIT_PREFIX,
	FACTORY_UNKNOWN_SESSION_COST_USD,
	FACTORY_VERIFICATION_EXERCISE_HEADING,
	FACTORY_VERIFICATION_PROFILE_PATH,
	factoryAcceptanceConfigurationFindings,
	factoryActiveStage,
	factoryAgentsSchema,
	factoryAppEnvironmentSchema,
	factoryCandidateSchema,
	factoryCardCostLimitUsd,
	factoryDailySpendingLimitReason,
	factoryDesignConclusionSchema,
	factoryDiffSize,
	factoryIndependentReview,
	factoryModelFamily,
	factoryPlanApprovalBlocker,
	factoryPreparedScopeProblems,
	factoryRecordedReviewIndependence,
	factoryRepairRounds,
	factoryReplayRequestSchema,
	factoryRepositoryRelative,
	factoryRequiresIndependentReview,
	factoryReviewFindings,
	factoryReviewMode,
	factoryReviewSchema,
	factoryReviewSelectionSchema,
	factoryReviewSize,
	factoryReviewSizeEscalation,
	factoryRunRoute,
	factoryRunStateSchema,
	factorySensitivePaths,
	factorySessionCostUsd,
	factorySpendingLimitReason,
	factoryStampRequirement,
	factoryTaskConfigSchema,
	factoryUnstartedSessionIds,
	factoryVerificationProfileCanonicalJson,
	factoryVerificationProfileSchema,
	factoryVerificationReviewSchema,
	factoryVerifierNeeded,
	factoryWatchesPullRequest,
	factoryWorkflowConfigSchema,
	factoryWorkflowRecipeSchema,
	formatFactoryId,
	isFactoryHandsOff,
	parseFactoryId,
	parseFactoryJson,
	selectFactoryReviewAgents,
} from "./factory";
import { factoryDesignProgressSchema } from "./tasks";

describe("Factory implementer roster", () => {
	it("normalizes saved task, design and run agents without losing the original profile", () => {
		const implementer = {
			profile: "builder",
			resolvedProfile: {
				name: "builder",
				description: "Build",
				systemPrompt: "Keep scope small",
			},
			modelSelection: { providerId: "provider", modelId: "model" },
		};
		const agents = { implementer };
		const task = factoryTaskConfigSchema.parse({ agents });
		const design = factoryDesignProgressSchema.parse({
			agents,
			revision: 1,
			repairRound: 0,
			designerSessionId: "designer",
			findings: [],
			phase: "designing",
		});
		const run = factoryRunStateSchema.parse({
			agents,
			phase: "implementing",
			repairRound: 0,
			sessions: [],
			workspace: {
				path: "/candidate",
				branch: "feature",
				baseBranch: "main",
				baseCommit: "base",
			},
		});
		for (const normalized of [task.agents, design.agents, run.agents]) {
			expect(normalized?.implementers).toEqual([implementer]);
			expect(normalized).not.toHaveProperty("implementer");
		}
	});

	it("defaults to one implementer, bounds the roster, and prefers explicit roster over legacy input", () => {
		expect(factoryAgentsSchema.parse({}).implementers).toEqual([{}]);
		expect(factoryAgentsSchema.safeParse({ implementers: [] }).success).toBe(
			false,
		);
		expect(
			factoryAgentsSchema.safeParse({ implementers: [{}, {}, {}, {}] }).success,
		).toBe(true);
		expect(
			factoryAgentsSchema.safeParse({ implementers: [{}, {}, {}, {}, {}] })
				.success,
		).toBe(false);
		expect(
			factoryAgentsSchema.parse({
				implementer: { profile: "old" },
				implementers: [{ profile: "new" }],
			}).implementers,
		).toEqual([{ profile: "new" }]);
	});
});

describe("adaptive Factory selection boundary", () => {
	const selection = {
		impact: "local",
		rationale: "Local change",
		affectedPaths: ["src/feature.ts"],
		consumers: ["feature view"],
		planReviewerIndices: [],
		reviewerIndices: [0],
	};
	it.each([
		{ reviewerIndices: [] },
		{ reviewerIndices: [0, 0] },
		{ reviewerIndices: [-1] },
		{ affectedPaths: ["/tmp/feature.ts"] },
		{ affectedPaths: ["src/../feature.ts"] },
		{ impact: "shared_contract" },
		{ impact: "cross_cutting", planReviewerIndices: [0] },
	])("rejects invalid or insufficient risk selection %j", (patch) => {
		expect(
			factoryReviewSelectionSchema.safeParse({ ...selection, ...patch })
				.success,
		).toBe(false);
	});
	it("reports insufficient configured pool capacity instead of downgrading shared-contract review", () => {
		const parsed = factoryReviewSelectionSchema.parse({
			...selection,
			impact: "shared_contract",
			planReviewerIndices: [0],
			reviewerIndices: [0, 1],
		});
		expect(() =>
			selectFactoryReviewAgents(
				factoryAgentsSchema.parse({ planReviewers: [{}] }),
				parsed,
			),
		).toThrow("configure enough reviewers");
	});
});

describe("Factory acceptance criteria", () => {
	const config = factoryTaskConfigSchema.parse({
		agents: { verifier: { instructions: "Start: bun run dev" } },
		checks: [{ name: "unit", command: "bun test", kind: "test" }],
		acceptanceCriteria: [
			{ id: "saves", text: "Saving keeps the draft", check: "unit" },
			{ id: "visible", text: "The saved draft is visible after reload" },
			{ id: "fast", text: "Reload feels instant", required: false },
		],
	});
	const criteria = config.acceptanceCriteria ?? [];
	const passedCheck = {
		name: "unit",
		kind: "test" as const,
		command: "bun test",
		status: "passed" as const,
		exitCode: 0,
		output: "",
		artifacts: [],
	};
	const verification = (acceptance?: unknown) => ({
		sessionId: "verifier",
		artifacts: [],
		review: factoryVerificationReviewSchema.parse({
			verdict: "pass",
			summary: "Verified",
			findings: [],
			acceptance,
		}),
	});

	it("defaults criteria to required and rejects duplicate IDs or invalid references", () => {
		expect(criteria.map((criterion) => criterion.required)).toEqual([
			true,
			true,
			false,
		]);
		expect(
			factoryTaskConfigSchema.safeParse({
				acceptanceCriteria: [
					{ id: "same", text: "One" },
					{ id: "same", text: "Two" },
				],
			}).success,
		).toBe(false);
		expect(factoryAcceptanceConfigurationFindings(config)).toEqual([]);
		expect(
			factoryAcceptanceConfigurationFindings({
				...config,
				checks: [],
				agents: undefined,
			}),
		).toEqual([
			expect.stringContaining('names check "unit"'),
			expect.stringContaining('"visible" needs'),
			expect.stringContaining('"fast" needs'),
		]);
	});

	it("does not accept a bare global pass for verifier-owned criteria", () => {
		const results = evaluateFactoryAcceptance(criteria, {
			checks: [passedCheck],
			verification: verification(),
		});
		expect(results.map(({ outcome, evidence }) => [outcome, evidence])).toEqual(
			[
				["passed", 'Check "unit" passed (exit 0)'],
				["unverified", undefined],
				["unverified", undefined],
			],
		);
		expect(
			results
				.filter(
					({ criterion, outcome }) =>
						criterion.required && outcome !== "passed",
				)
				.map(({ criterion }) => criterion.id),
		).toEqual(["visible"]);
	});

	it("maps failed checks and the worst verifier result for each criterion", () => {
		const results = evaluateFactoryAcceptance(criteria, {
			checks: [
				passedCheck,
				{ ...passedCheck, status: "blocked", exitCode: null },
				{ ...passedCheck, status: "failed", exitCode: 1 },
			],
			verification: verification([
				{
					criterionId: "visible",
					outcome: "passed",
					evidence: "Reloaded and saw draft",
				},
				{
					criterionId: "visible",
					outcome: "unverified",
					evidence: "First attempt interrupted",
				},
				{
					criterionId: "visible",
					outcome: "failed",
					evidence: "Second reload lost it",
				},
				{
					criterionId: "fast",
					outcome: "unverified",
					evidence: "No timing harness",
				},
			]),
		});
		expect(results.map(({ outcome, evidence }) => [outcome, evidence])).toEqual(
			[
				["failed", 'Check "unit" failed (exit 1)'],
				["failed", "Second reload lost it"],
				["unverified", "No timing harness"],
			],
		);
	});

	it("keeps historical verification reports readable without acceptance results", () => {
		const candidate = factoryCandidateSchema.parse({
			commit: "abc",
			checks: [],
			reviews: [],
			verification: {
				sessionId: "verifier",
				artifacts: [],
				review: {
					verdict: "pass",
					summary: "Legacy",
					findings: [],
					coverage: { static: [], exercised: ["ran app"], unverified: [] },
				},
			},
		});
		expect(candidate.verification?.review.acceptance).toBeUndefined();
		expect(evaluateFactoryAcceptance([], candidate)).toEqual([]);
	});
});

describe("Factory replay request", () => {
	const request = {
		taskId: "task",
		runId: "run",
		comparisonId: "cmp_1-a",
		variants: [{ label: "Original" }],
	};
	it.each([
		{ comparisonId: "has space" },
		{ comparisonId: "x".repeat(101) },
		{ variants: [] },
		{
			variants: Array.from({ length: 5 }, (_, index) => ({
				label: `${index}`,
			})),
		},
		{ variants: [{ label: " " }] },
		{
			variants: [
				{ label: "Bad recipe", recipe: { schemaVersion: 1, name: "x" } },
			],
		},
	])("rejects invalid request %j", (patch) => {
		expect(
			factoryReplayRequestSchema.safeParse({ ...request, ...patch }).success,
		).toBe(false);
	});
	it("accepts the original workflow without a recipe", () => {
		expect(factoryReplayRequestSchema.parse(request)).toEqual(request);
	});
});

describe("Factory verifier app environment", () => {
	it.each([
		{ setup: "bun install" },
		{ start: "bun run dev" },
		{
			setup: "bun install",
			start: "bun run dev --port $FACTORY_APP_PORT",
			healthcheck: "curl -sf $FACTORY_APP_URL",
			cleanup: "rm -rf .cache",
			portEnv: "VITE_PORT",
			readyTimeoutSeconds: 900,
		},
	])("accepts %j", (environment) => {
		expect(factoryAppEnvironmentSchema.parse(environment)).toEqual(environment);
	});

	it.each([
		[{}, "Provide a setup or start command"],
		[{ cleanup: "rm -rf .cache" }, "Provide a setup or start command"],
		[{ setup: "  " }, undefined],
		[
			{ setup: "bun install", healthcheck: "curl -sf $FACTORY_APP_URL" },
			"A healthcheck needs a start command",
		],
		[{ start: "bun run dev", portEnv: "1PORT" }, undefined],
		[{ start: "bun run dev", portEnv: "APP-PORT" }, undefined],
		[{ start: "bun run dev", portEnv: "" }, undefined],
		[{ start: "bun run dev", portEnv: `P${"A".repeat(64)}` }, undefined],
		[{ start: "bun run dev", readyTimeoutSeconds: 0 }, undefined],
		[{ start: "bun run dev", readyTimeoutSeconds: 901 }, undefined],
		[{ start: "bun run dev", readyTimeoutSeconds: 1.5 }, undefined],
	])("rejects %j", (environment, message) => {
		const result = factoryAppEnvironmentSchema.safeParse(environment);
		expect(result.success).toBe(false);
		if (message)
			expect(result.error?.issues.map((issue) => issue.message)).toContain(
				message,
			);
	});

	it("keeps parsed workflow JSON identical when no environment is configured", () => {
		// The workflow revision is a hash of this JSON; it must not change for saved workflows.
		const parsed = factoryWorkflowConfigSchema.parse({
			agents: {
				verifier: { instructions: "Check the page", artifacts: ["shot.png"] },
			},
			maxCostUsd: 5,
		});
		expect(JSON.stringify(parsed)).toBe(
			'{"agents":{"designer":{},"planReviewers":[],"implementers":[{}],"reviewers":[{}],"verifier":{"instructions":"Check the page","artifacts":["shot.png"]}},"approval":"required","maxCostUsd":5,"maxRepairRounds":2}',
		);
		expect(
			JSON.stringify(factoryWorkflowConfigSchema.parse({ agents: {} })),
		).toBe(
			'{"agents":{"designer":{},"planReviewers":[],"implementers":[{}],"reviewers":[{}]},"approval":"required","maxRepairRounds":2}',
		);
	});

	it("round-trips a verifier environment through workflow and task config", () => {
		const environment = {
			setup: "bun install",
			start: "bun run dev",
			healthcheck: "curl -sf $FACTORY_APP_URL",
		};
		const workflow = factoryWorkflowConfigSchema.parse({
			agents: { verifier: { environment } },
		});
		expect(workflow.agents?.verifier?.environment).toEqual(environment);
		expect(factoryWorkflowConfigSchema.parse(workflow)).toEqual(workflow);
		const task = factoryTaskConfigSchema.parse({
			agents: { verifier: { environment } },
		});
		expect(task.agents?.verifier?.environment).toEqual(environment);
		expect(
			factoryWorkflowConfigSchema.safeParse({
				agents: { verifier: { environment: {} } },
			}).success,
		).toBe(false);
	});

	it("records the running verifier app in run state", () => {
		const base = {
			phase: "verifying",
			repairRound: 0,
			sessions: [],
			workspace: {
				path: "/candidate",
				branch: "feature",
				baseBranch: "main",
				baseCommit: "base",
			},
		};
		expect(factoryRunStateSchema.parse(base)).not.toHaveProperty(
			"verifierEnvironment",
		);
		const verifierEnvironment = {
			key: "verify:0",
			port: 41234,
			token: "token-1",
			setupPid: 998,
			pid: 999,
		};
		expect(
			factoryRunStateSchema.parse({ ...base, verifierEnvironment })
				.verifierEnvironment,
		).toEqual(verifierEnvironment);
		expect(
			factoryRunStateSchema.safeParse({
				...base,
				verifierEnvironment: { key: "verify:0", port: 0 },
			}).success,
		).toBe(false);
	});
});

describe("PR evidence details", () => {
	it("is opt-in with no default", () => {
		expect(factoryTaskConfigSchema.parse({})).not.toHaveProperty(
			"pullRequestEvidenceDetails",
		);
		expect(
			factoryTaskConfigSchema.parse({ pullRequestEvidenceDetails: true })
				.pullRequestEvidenceDetails,
		).toBe(true);
	});
});

describe("Factory hands-off autonomy", () => {
	it("is optional with no default, so saved workflow JSON is unchanged", () => {
		const parsed = factoryWorkflowConfigSchema.parse({});
		expect(parsed).not.toHaveProperty("autonomy");
		expect(JSON.stringify(parsed)).toBe(
			'{"approval":"required","maxRepairRounds":2}',
		);
		expect(
			factoryWorkflowConfigSchema.parse({ autonomy: "hands_off" }).autonomy,
		).toBe("hands_off");
		expect(
			factoryTaskConfigSchema.parse({ autonomy: "hands_off" }).autonomy,
		).toBe("hands_off");
		expect(
			factoryWorkflowConfigSchema.safeParse({ autonomy: "supervised" }).success,
		).toBe(false);
	});

	it("keeps approval as a separate plan checkpoint", () => {
		const parsed = factoryTaskConfigSchema.parse({ autonomy: "hands_off" });
		expect(parsed.approval).toBe("required");
	});

	it("detects hands-off configs", () => {
		expect(isFactoryHandsOff({ autonomy: "hands_off" })).toBe(true);
		expect(isFactoryHandsOff({})).toBe(false);
		expect(isFactoryHandsOff({ autonomy: "other" })).toBe(false);
		expect(isFactoryHandsOff(undefined)).toBe(false);
	});

	it("defaults publishing on for hands-off raw configs and leaves PR watching to its one default", () => {
		const raw = { autonomy: "hands_off", title: "x" };
		const applied = applyFactoryAutonomyDefaults(raw);
		expect(applied).toEqual({
			autonomy: "hands_off",
			title: "x",
			publishPullRequest: true,
		});
		expect(raw).not.toHaveProperty("publishPullRequest");
		const parsed = factoryTaskConfigSchema.parse(applied);
		expect(parsed.publishPullRequest).toBe(true);
		// Unset, so the card's workflow revision matches its workflow's; it
		// reads as on for hands-off work.
		expect(parsed.watchPullRequest).toBeUndefined();
		expect(factoryWatchesPullRequest(parsed)).toBe(true);
		expect(
			applyFactoryAutonomyDefaults({ ...raw, watchPullRequest: false }),
		).toMatchObject({ watchPullRequest: false });
	});

	it("has one PR follow-up default: an explicit choice, else on for hands-off only", () => {
		expect(factoryWatchesPullRequest({ autonomy: "hands_off" })).toBe(true);
		expect(
			factoryWatchesPullRequest({
				autonomy: "hands_off",
				watchPullRequest: false,
			}),
		).toBe(false);
		expect(factoryWatchesPullRequest({ approval: "automatic" } as never)).toBe(
			false,
		);
		expect(factoryWatchesPullRequest({ watchPullRequest: true })).toBe(true);
		expect(factoryWatchesPullRequest(undefined)).toBe(false);
		// A workflow carries the choice; leaving it out keeps old revisions.
		expect(
			factoryWorkflowConfigSchema.parse({ watchPullRequest: false })
				.watchPullRequest,
		).toBe(false);
		expect(factoryWorkflowConfigSchema.parse({})).not.toHaveProperty(
			"watchPullRequest",
		);
	});

	it("keeps explicit false choices", () => {
		expect(
			applyFactoryAutonomyDefaults({
				autonomy: "hands_off",
				publishPullRequest: false,
				watchPullRequest: false,
			}),
		).toEqual({
			autonomy: "hands_off",
			publishPullRequest: false,
			watchPullRequest: false,
		});
		expect(
			applyFactoryAutonomyDefaults({
				autonomy: "hands_off",
				watchPullRequest: false,
			}),
		).toEqual({
			autonomy: "hands_off",
			publishPullRequest: true,
			watchPullRequest: false,
		});
	});

	it("returns non-hands-off input unchanged", () => {
		const raw = { publishPullRequest: false };
		expect(applyFactoryAutonomyDefaults(raw)).toBe(raw);
		expect(applyFactoryAutonomyDefaults({ approval: "automatic" })).toEqual({
			approval: "automatic",
			publishPullRequest: true,
		});
		expect(
			applyFactoryAutonomyDefaults({
				approval: "automatic",
				publishPullRequest: false,
			}),
		).toMatchObject({ publishPullRequest: false });
		expect(applyFactoryAutonomyDefaults(undefined)).toBeUndefined();
		expect(applyFactoryAutonomyDefaults(null)).toBeNull();
	});

	it("accepts a hands-off workflow recipe", () => {
		const recipe = {
			schemaVersion: 1,
			name: "Hands off",
			revision: "a".repeat(64),
			config: { autonomy: "hands_off" },
		};
		expect(factoryWorkflowRecipeSchema.parse(recipe).config.autonomy).toBe(
			"hands_off",
		);
	});

	it("records one automatic recovery in run state", () => {
		const base = {
			phase: "implementing",
			repairRound: 0,
			sessions: [],
			workspace: {
				path: "/candidate",
				branch: "feature",
				baseBranch: "main",
				baseCommit: "base",
			},
		};
		expect(factoryRunStateSchema.parse(base)).not.toHaveProperty(
			"autoRecovery",
		);
		const autoRecovery = {
			attempts: 1,
			reason: "Builder session crashed",
			at: "2026-11-11T00:00:00.000Z",
		};
		expect(
			factoryRunStateSchema.parse({ ...base, autoRecovery }).autoRecovery,
		).toEqual(autoRecovery);
		for (const attempts of [-1, 1.5])
			expect(
				factoryRunStateSchema.safeParse({
					...base,
					autoRecovery: { ...autoRecovery, attempts },
				}).success,
			).toBe(false);
	});
});

describe("Factory PR outcome and route", () => {
	const base = {
		phase: "ready",
		repairRound: 0,
		sessions: [],
		workspace: {
			path: "/candidate",
			branch: "feature",
			baseBranch: "main",
			baseCommit: "base",
		},
	};
	const usage = (totalCost: number) => ({
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost,
	});
	const attempt = (
		key: string,
		role: "builder" | "reviewer" | "verifier",
		sessionId: string,
		totalCost?: number,
	) => ({
		id: key,
		key,
		role,
		repairRound: 0,
		createdAt: "2026-11-11T00:00:00.000Z",
		sessionId,
		instructions: "Work",
		agent: {},
		status: "completed",
		summary: "Done",
		completedAt: "2026-11-11T00:01:00.000Z",
		...(totalCost === undefined ? {} : { usage: usage(totalCost) }),
	});
	const selection = {
		impact: "local",
		size: "trivial",
		rationale: "One line.",
		affectedPaths: ["src/app.ts"],
		consumers: ["app"],
		planReviewerIndices: [],
		reviewerIndices: [0],
	};

	it("keeps older runs without an outcome readable and round-trips one", () => {
		expect(factoryRunStateSchema.parse(base)).not.toHaveProperty(
			"pullRequestOutcome",
		);
		const pullRequestOutcome = {
			state: "merged",
			headChanged: true,
			at: "2026-11-11T00:00:00.000Z",
		};
		expect(
			factoryRunStateSchema.parse({ ...base, pullRequestOutcome })
				.pullRequestOutcome,
		).toEqual(pullRequestOutcome);
	});

	it("explains a sensitive route and splits its cost by station from stored usage", () => {
		const state = factoryRunStateSchema.parse({
			...base,
			reviewSelection: {
				...selection,
				impact: "shared_contract",
				size: "shared_contract",
				affectedPaths: [".env.example"],
				planReviewerIndices: [0],
				reviewerIndices: [0, 1],
			},
			sessions: [{ sessionId: "build-1", role: "builder" }],
			// Scoping sessions are seeded without attempts; build-1's usage was
			// resolved later, so the attempt has none of its own.
			sessionUsage: [
				{ sessionId: "design", usage: usage(0.04) },
				{ sessionId: "plan-review", usage: usage(0.02) },
				{ sessionId: "build-1", usage: usage(0.31) },
			],
			attempts: [
				attempt("builder:0", "builder", "build-1"),
				attempt("reviewer:0:0:c:0", "reviewer", "review-0", 0.9),
				attempt("reviewer:1:0:c:0", "reviewer", "review-1", 0.8),
				attempt("reviewer:1:1:d:0", "reviewer", "review-1b", 0.1),
				attempt("triage:c:x", "reviewer", "triage", 0.09),
				attempt("verifier:0:c", "verifier", "test", 0.4),
			],
		});
		const route = factoryRunRoute(state);
		expect(route).toMatchObject({
			size: "shared_contract",
			escalated: false,
			sensitivePaths: [".env.example"],
			planReviewers: 1,
			reviewers: 2,
			tester: true,
		});
		expect(route?.cost.scoping).toBeCloseTo(0.06);
		expect(route?.cost.build).toBeCloseTo(0.31);
		expect(route?.cost.test).toBeCloseTo(0.4);
		expect(route?.cost.review).toBeCloseTo(1.89);
		expect(factoryRunRoute({ ...state, reviewSelection: undefined })).toBe(
			undefined,
		);
	});

	it("costs repository stage sessions under build and counts the stages that ran", () => {
		const stage = (id: string, status: string) => ({
			id,
			name: id,
			kind: "command",
			hash: "h",
			blocking: true,
			status,
		});
		const state = factoryRunStateSchema.parse({
			...base,
			reviewSelection: selection,
			attempts: [
				attempt("builder:0", "builder", "build", 0.3),
				{
					...attempt("stage:docs:0:c", "reviewer", "docs", 0.2),
					stageId: "docs",
				},
				attempt("reviewer:0:0:c:0", "reviewer", "review", 0.5),
			],
			candidate: {
				commit: "c",
				checks: [],
				reviews: [],
				stages: [
					stage("lint", "passed"),
					stage("docs", "failed"),
					stage("scan", "skipped"),
				],
			},
		});
		const route = factoryRunRoute(state);
		expect(route?.cost.build).toBeCloseTo(0.5);
		expect(route?.cost.review).toBeCloseTo(0.5);
		expect(route).toMatchObject({ reviewers: 1, stages: 2 });
		// Older runs without stages still parse.
		expect(factoryRunRoute({ ...state, candidate: undefined })?.stages).toBe(0);
	});

	it("names the repository stage running now, before or after the candidate exists", () => {
		const plan = {
			stages: [
				{
					hash: "h",
					stage: {
						id: "docs",
						name: "Docs update",
						kind: "agent",
						instruction: "Update docs",
						access: "write",
					},
				},
			],
			unapproved: [],
		};
		const writing = factoryRunStateSchema.parse({
			...base,
			stagePlan: plan,
			attempts: [
				{
					...attempt("stage:docs:0", "builder", "docs"),
					status: "running",
					summary: undefined,
					completedAt: undefined,
					stageId: "docs",
				},
			],
		});
		expect(factoryActiveStage(writing)).toBe("Docs update");
		expect(
			factoryActiveStage({
				...base,
				candidate: {
					commit: "c",
					checks: [],
					reviews: [],
					stages: [
						{
							id: "lint",
							name: "Lint",
							kind: "command",
							hash: "h",
							blocking: true,
							status: "running",
						},
					],
				},
			} as never),
		).toBe("Lint");
		expect(factoryActiveStage(factoryRunStateSchema.parse(base))).toBe(
			undefined,
		);
	});
});

describe("Factory design conclusion", () => {
	const conclusion = {
		outcome: "already_fixed",
		rationale: "The guard already exists",
		evidence: ["src/feature.ts:42"],
	};

	it("adds the designer triage opt-in without changing parsed workflows that omit it", () => {
		expect(
			JSON.stringify(factoryWorkflowConfigSchema.parse({ agents: {} })),
		).toBe(
			'{"agents":{"designer":{},"planReviewers":[],"implementers":[{}],"reviewers":[{}]},"approval":"required","maxRepairRounds":2}',
		);
		const workflow = factoryWorkflowConfigSchema.parse({
			agents: { designer: { instructions: "Scope it", triage: true } },
		});
		expect(workflow.agents?.designer).toEqual({
			instructions: "Scope it",
			triage: true,
		});
		expect(factoryWorkflowConfigSchema.parse(workflow)).toEqual(workflow);
		expect(
			factoryAgentsSchema.safeParse({ designer: { triage: "yes" } }).success,
		).toBe(false);
	});

	it("accepts concrete conclusions", () => {
		expect(factoryDesignConclusionSchema.parse(conclusion)).toEqual(conclusion);
		expect(
			factoryDesignConclusionSchema.parse({
				...conclusion,
				outcome: "duplicate",
				duplicateOf: "task_123",
			}).duplicateOf,
		).toBe("task_123");
	});

	it.each([
		{ outcome: "duplicate" },
		{ outcome: "duplicate", duplicateOf: " " },
		{ evidence: [] },
		{ evidence: undefined },
		{ evidence: [" "] },
		{ rationale: " " },
		{ outcome: "wont_fix" },
	])("rejects %j", (patch) => {
		expect(
			factoryDesignConclusionSchema.safeParse({ ...conclusion, ...patch })
				.success,
		).toBe(false);
	});

	it("names the missing duplicate target", () => {
		expect(
			factoryDesignConclusionSchema
				.safeParse({ ...conclusion, outcome: "duplicate" })
				.error?.issues.map((issue) => issue.message),
		).toEqual(["A duplicate names the existing card"]);
	});

	const progress = (revision: number, extra: Record<string, unknown> = {}) =>
		factoryDesignProgressSchema.parse({
			revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "complete",
			reviewerSessions: [],
			reviews: [],
			...extra,
		});

	it("parses legacy design progress without a conclusion", () => {
		const legacy = progress(1);
		expect(legacy).not.toHaveProperty("conclusion");
		expect(progress(1, { conclusion }).conclusion).toEqual(conclusion);
		expect(() =>
			progress(1, { conclusion: { ...conclusion, evidence: [] } }),
		).toThrow();
	});

	it("blocks plan approval for a current-revision conclusion only", () => {
		const factory = factoryTaskConfigSchema.parse({
			checks: [{ name: "unit", command: "bun test", kind: "test" }],
			acceptanceCriteria: [{ id: "works", text: "It works", check: "unit" }],
		});
		const task = {
			revision: 2,
			instructions: "Fix the bug",
			factoryDesignReview: undefined,
			factory,
		};
		expect(
			factoryPlanApprovalBlocker({
				...task,
				factoryDesignProgress: progress(2, {
					conclusion: { ...conclusion, outcome: "no_change" },
				}),
			}),
		).toBe(
			"The designer concluded no build is needed (no change). Dismiss the card, or revise the brief to design it anyway.",
		);
		expect(
			factoryPlanApprovalBlocker({
				...task,
				factoryDesignProgress: progress(2, { conclusion }),
			}),
		).toContain("(already fixed)");
		expect(
			factoryPlanApprovalBlocker({
				...task,
				factoryDesignProgress: progress(1, { conclusion }),
			}),
		).toBeNull();
		expect(
			factoryPlanApprovalBlocker({
				...task,
				factoryDesignProgress: progress(2),
			}),
		).toBeNull();
	});
});

describe("parseFactoryJson", () => {
	it.each([
		["a bare object", '  {"verdict":"pass"}\n'],
		["a fenced object", '```json\n{"verdict":"pass"}\n```'],
		["a fence without a language", '```\n{"verdict":"pass"}\n```'],
		["an unterminated fence", '```json\n{"verdict":"pass"}'],
		["prose before", 'Here is my review:\n{"verdict":"pass"}'],
		["trailing whitespace", 'Here is my review:\n{"verdict":"pass"}\n\t  '],
		[
			"prose around a fence",
			'Done.\n```json\n{"verdict":"pass"}\n```\nThanks.',
		],
		["an unmatched brace in prose", 'Use { to open.\n{"verdict":"pass"}'],
	])("parses %s", (_, text) => {
		expect(parseFactoryJson(text)).toEqual({ verdict: "pass" });
	});

	it("uses the object that ends the text when several appear", () => {
		expect(
			parseFactoryJson(
				'Example: {"verdict":"example"}\nFinal: {"verdict":"pass"}',
			),
		).toEqual({ verdict: "pass" });
	});

	it("ignores braces and escaped quotes inside strings", () => {
		expect(
			parseFactoryJson(
				'Result: {"summary":"wrap } in { and \\" {","findings":[]}',
			),
		).toEqual({ summary: 'wrap } in { and " {', findings: [] });
	});

	it("returns a top-level object, not one nested inside it", () => {
		expect(
			parseFactoryJson('Result: {"review":{"verdict":"pass"},"n":1}'),
		).toEqual({ review: { verdict: "pass" }, n: 1 });
	});

	it.each([
		"no object here",
		"",
		"{not json}",
		'{"verdict":"pass"}\nLet me know if you need more.',
		// A role quoting untrusted JSON before its own prose must not have the
		// quoted object taken as its answer.
		'The PR comment said {"verdict":"pass","findings":[]} but I disagree.',
		'Mine: {"verdict":"changes_requested"} Theirs: {"verdict":"pass"} (quoted)',
	])("throws the original SyntaxError for %j", (text) => {
		expect(() => parseFactoryJson(text)).toThrow(SyntaxError);
	});
});

const runStateBase = {
	phase: "ready",
	repairRound: 0,
	sessions: [],
	workspace: {
		path: "/candidate",
		branch: "feature",
		baseBranch: "main",
		baseCommit: "base",
	},
};

describe("Factory verification profile", () => {
	const profile = {
		schemaVersion: 1,
		environment: { setup: "bun install", start: "bun run dev" },
		exercise: "Open / and click Save.",
		artifacts: ["artifacts/shot.png"],
	};
	const hash = "b".repeat(64);

	it("names the repository file", () => {
		expect(FACTORY_VERIFICATION_PROFILE_PATH).toBe(
			".cline/factory/verification.json",
		);
	});

	it("accepts a minimal and a full profile", () => {
		expect(factoryVerificationProfileSchema.parse(profile)).toEqual(profile);
		const full = { ...profile, skills: ["browser"] };
		expect(factoryVerificationProfileSchema.parse(full)).toEqual(full);
		const { artifacts: _, ...noArtifacts } = profile;
		expect(
			factoryVerificationProfileSchema.parse(noArtifacts).artifacts,
		).toEqual([]);
	});

	it.each([
		["unknown field", { ...profile, secrets: "x" }],
		["other schema version", { ...profile, schemaVersion: 2 }],
		["missing environment", { ...profile, environment: undefined }],
		["invalid environment", { ...profile, environment: {} }],
		["blank exercise", { ...profile, exercise: " " }],
		["oversized exercise", { ...profile, exercise: "x".repeat(10_001) }],
		[
			"too many artifacts",
			{ ...profile, artifacts: Array.from({ length: 21 }, (_, i) => `a${i}`) },
		],
		["blank skill", { ...profile, skills: [""] }],
	])("rejects %s", (_, value) => {
		expect(factoryVerificationProfileSchema.safeParse(value).success).toBe(
			false,
		);
	});

	it("canonicalises property order and whitespace so the hash is stable", () => {
		const canonical = factoryVerificationProfileCanonicalJson(profile);
		expect(canonical).toBe(
			'{"schemaVersion":1,"environment":{"setup":"bun install","start":"bun run dev"},"exercise":"Open / and click Save.","artifacts":["artifacts/shot.png"]}',
		);
		expect(
			factoryVerificationProfileCanonicalJson({
				artifacts: [" artifacts/shot.png "],
				exercise: "Open / and click Save.\n",
				environment: { start: "bun run dev", setup: "bun install" },
				schemaVersion: 1,
			}),
		).toBe(canonical);
		expect(() => factoryVerificationProfileCanonicalJson({})).toThrow();
	});

	it("freezes in task config only, so recipe revisions do not move", () => {
		const verificationProfile = { profile, hash, origin: "proposed" };
		expect(
			factoryTaskConfigSchema.parse({ verificationProfile })
				.verificationProfile,
		).toEqual(verificationProfile);
		for (const invalid of [
			{ ...verificationProfile, hash: "short" },
			{ ...verificationProfile, origin: "builder" },
			{ ...verificationProfile, profile: { ...profile, extra: 1 } },
		])
			expect(
				factoryTaskConfigSchema.safeParse({ verificationProfile: invalid })
					.success,
			).toBe(false);
		const workflow = factoryWorkflowConfigSchema.parse({
			agents: {},
			verificationProfile,
		});
		expect(workflow).not.toHaveProperty("verificationProfile");
		expect(JSON.stringify(workflow)).toBe(
			'{"agents":{"designer":{},"planReviewers":[],"implementers":[{}],"reviewers":[{}]},"approval":"required","maxRepairRounds":2}',
		);
	});

	it("records preflight in run state", () => {
		expect(factoryRunStateSchema.parse(runStateBase)).not.toHaveProperty(
			"verificationProfile",
		);
		const verificationProfile = {
			hash,
			preflight: "failed",
			stage: "healthcheck",
			detail: "exit 7",
		};
		expect(
			factoryRunStateSchema.parse({ ...runStateBase, verificationProfile })
				.verificationProfile,
		).toEqual(verificationProfile);
		expect(
			factoryRunStateSchema.safeParse({
				...runStateBase,
				verificationProfile: { hash, preflight: "skipped" },
			}).success,
		).toBe(false);
	});

	describe("applyFactoryVerificationProfile", () => {
		const parsed = factoryVerificationProfileSchema.parse({
			...profile,
			skills: ["browser"],
		});

		it("materialises a verifier when the preset has none", () => {
			const applied = applyFactoryVerificationProfile(
				DEFAULT_FACTORY_AGENTS,
				parsed,
			);
			expect(DEFAULT_FACTORY_AGENTS.verifier).toBeUndefined();
			expect(applied.verifier).toEqual({
				environment: profile.environment,
				instructions: `${FACTORY_VERIFICATION_EXERCISE_HEADING}\n\`\`\`text\nOpen / and click Save.\n\`\`\``,
				artifacts: ["artifacts/shot.png"],
				skills: ["browser"],
			});
			expect(applied.reviewers).toBe(DEFAULT_FACTORY_AGENTS.reviewers);
			expect(factoryAgentsSchema.parse(applied)).toEqual(applied);
			expect(
				factoryAcceptanceConfigurationFindings({
					acceptanceCriteria: [{ id: "ui", text: "Saves", required: true }],
					checks: [],
					agents: applied,
				}),
			).toEqual([]);
		});

		it("lets a preset environment win whole-object and unions the rest", () => {
			const presetEnvironment = { start: "make serve" };
			const agents = factoryAgentsSchema.parse({
				verifier: {
					instructions: "Check the page",
					environment: presetEnvironment,
					artifacts: ["preset.png", "artifacts/shot.png"],
					skills: ["browser", "a11y"],
				},
			});
			const applied = applyFactoryVerificationProfile(agents, parsed);
			expect(applied.verifier?.environment).toEqual(presetEnvironment);
			expect(applied.verifier?.artifacts).toEqual([
				"preset.png",
				"artifacts/shot.png",
			]);
			expect(applied.verifier?.skills).toEqual(["browser", "a11y"]);
			expect(applied.verifier?.instructions).toMatch(
				/^Check the page\n\nHow to exercise the app/,
			);
			expect(agents.verifier?.instructions).toBe("Check the page");
		});

		it("applies the profile environment when the preset verifier has none", () => {
			const agents = factoryAgentsSchema.parse({
				verifier: { instructions: "Check" },
			});
			expect(
				applyFactoryVerificationProfile(agents, parsed).verifier?.environment,
			).toEqual(profile.environment);
		});

		it("is idempotent and fences backticks in the exercise", () => {
			const fenced = factoryVerificationProfileSchema.parse({
				...profile,
				exercise: "Run ```rm -rf``` never",
			});
			const once = applyFactoryVerificationProfile(
				DEFAULT_FACTORY_AGENTS,
				fenced,
			);
			expect(once.verifier?.instructions).toContain(
				"````text\nRun ```rm -rf``` never\n````",
			);
			expect(applyFactoryVerificationProfile(once, fenced)).toEqual(once);
		});

		it("caps unioned artifacts at the verifier limit", () => {
			const agents = factoryAgentsSchema.parse({
				verifier: {
					artifacts: Array.from({ length: 20 }, (_, i) => `p${i}`),
				},
			});
			const applied = applyFactoryVerificationProfile(agents, parsed);
			expect(applied.verifier?.artifacts).toHaveLength(20);
			expect(applied.verifier?.artifacts).not.toContain("artifacts/shot.png");
		});
	});
});

describe("Factory review rule candidates", () => {
	const review = {
		verdict: "pass",
		summary: "Fine",
		findings: [],
	};
	const candidate = {
		key: "no-raw-fetch",
		kind: "lint",
		pattern: "fetch( called outside api/",
		suggestion: "Add a lint rule banning fetch outside api/",
	};

	it("parses legacy reviews without candidates", () => {
		const parsed = factoryReviewSchema.parse(review);
		expect(parsed.ruleCandidates).toBeUndefined();
		expect(JSON.stringify(parsed)).toBe(
			'{"verdict":"pass","summary":"Fine","findings":[]}',
		);
	});

	it("accepts up to two candidates without making them findings", () => {
		const parsed = factoryReviewSchema.parse({
			...review,
			ruleCandidates: [
				candidate,
				{ ...candidate, key: "abc", kind: "agent_rule" },
			],
		});
		expect(parsed.ruleCandidates).toHaveLength(2);
		expect(factoryReviewFindings(parsed)).toEqual([]);
		const verifier = factoryVerificationReviewSchema.parse({
			...review,
			ruleCandidates: [candidate],
		});
		expect(verifier.ruleCandidates).toEqual([candidate]);
	});

	it.each([
		["three candidates", [candidate, candidate, candidate]],
		["uppercase key", [{ ...candidate, key: "NoFetch" }]],
		["short key", [{ ...candidate, key: "ab" }]],
		["long key", [{ ...candidate, key: `a${"b".repeat(60)}` }]],
		["key starting with a digit", [{ ...candidate, key: "1abc" }]],
		["unknown kind", [{ ...candidate, kind: "style" }]],
		["long pattern", [{ ...candidate, pattern: "x".repeat(501) }]],
		["long suggestion", [{ ...candidate, suggestion: "x".repeat(1001) }]],
		["not a list", "no-raw-fetch"],
	])("drops %s without failing the review", (_, ruleCandidates) => {
		const parsed = factoryReviewSchema.parse({ ...review, ruleCandidates });
		expect(parsed.ruleCandidates).toBeUndefined();
		expect(parsed.verdict).toBe("pass");
		expect(factoryReviewFindings(parsed)).toEqual([]);
	});
});

describe("Factory human stamp", () => {
	const local = {
		impact: "local" as const,
		rationale: "One file",
		affectedPaths: ["src/a.ts"],
		consumers: ["app"],
		planReviewerIndices: [],
		reviewerIndices: [0],
	};
	const escalation = { commit: "c", affectedPaths: ["x"], rationale: "r" };

	it("has no schema default, so recipe revisions are unchanged when absent", () => {
		expect(factoryWorkflowConfigSchema.parse({})).not.toHaveProperty(
			"humanStamp",
		);
		expect(
			factoryWorkflowConfigSchema.parse({ humanStamp: "never" }).humanStamp,
		).toBe("never");
		expect(
			factoryTaskConfigSchema.parse({ humanStamp: "by_risk" }).humanStamp,
		).toBe("by_risk");
		expect(
			factoryWorkflowConfigSchema.safeParse({ humanStamp: "sometimes" })
				.success,
		).toBe(false);
	});

	it("records the frozen requirement in run state", () => {
		expect(factoryRunStateSchema.parse(runStateBase)).not.toHaveProperty(
			"humanReview",
		);
		const humanReview = { required: true, reason: "shared contract" };
		expect(
			factoryRunStateSchema.parse({ ...runStateBase, humanReview }).humanReview,
		).toEqual(humanReview);
	});

	it.each([
		[
			"unset, supervised",
			{},
			{ reviewSelection: local },
			true,
			"workflow always requires a stamp",
		],
		[
			"unset, hands-off, local",
			{ autonomy: "hands_off" },
			{ reviewSelection: local },
			false,
			"local change",
		],
		[
			"by_risk, local",
			{ humanStamp: "by_risk" },
			{ reviewSelection: local },
			false,
			"local change",
		],
		[
			"by_risk, shared contract",
			{ humanStamp: "by_risk" },
			{ reviewSelection: { ...local, impact: "shared_contract" } },
			true,
			"shared contract",
		],
		[
			"by_risk, cross-cutting",
			{ autonomy: "hands_off" },
			{ reviewSelection: { ...local, impact: "cross_cutting" } },
			true,
			"cross cutting",
		],
		[
			"by_risk, escalated",
			{ autonomy: "hands_off" },
			{ reviewSelection: local, reviewEscalation: escalation },
			true,
			"review escalated",
		],
		[
			"by_risk, no selection",
			{ autonomy: "hands_off" },
			{},
			true,
			"impact unknown",
		],
		[
			"by_risk, proposed profile",
			{ autonomy: "hands_off", verificationProfile: { origin: "proposed" } },
			{ reviewSelection: local },
			true,
			"verification profile changed",
		],
		[
			"by_risk, trusted repository profile",
			{ autonomy: "hands_off", verificationProfile: { origin: "repository" } },
			{ reviewSelection: local },
			false,
			"local change",
		],
		[
			"by_risk, approved local profile",
			{
				autonomy: "hands_off",
				verificationProfile: { origin: "approved_local" },
			},
			{ reviewSelection: local },
			false,
			"local change",
		],
		[
			"always, hands-off, local",
			{ autonomy: "hands_off", humanStamp: "always" },
			{ reviewSelection: local },
			true,
			"workflow always requires a stamp",
		],
		[
			"by_risk, shared contract whose plan a person approved",
			{ autonomy: "hands_off" },
			{
				reviewSelection: {
					...local,
					impact: "shared_contract",
					affectedPaths: ["src/auth/session.ts"],
				},
				planApprovedByPerson: { revision: 3, at: "2035-01-01T00:00:00.000Z" },
			},
			false,
			"plan approved by a person",
		],
		[
			"by_risk, person-approved plan whose diff went beyond it",
			{ autonomy: "hands_off" },
			{
				reviewSelection: { ...local, impact: "shared_contract" },
				reviewEscalation: escalation,
				planApprovedByPerson: { revision: 3, at: "2035-01-01T00:00:00.000Z" },
			},
			true,
			"review escalated",
		],
		[
			"by_risk, person-approved plan with a changed profile",
			{ autonomy: "hands_off", verificationProfile: { origin: "proposed" } },
			{
				reviewSelection: { ...local, impact: "shared_contract" },
				planApprovedByPerson: { revision: 3, at: "2035-01-01T00:00:00.000Z" },
			},
			true,
			"verification profile changed",
		],
		[
			"never, escalated",
			{ humanStamp: "never" },
			{ reviewEscalation: escalation },
			false,
			"workflow never requires a stamp",
		],
	] as const)("%s", (_, config, state, required, reason) => {
		expect(
			factoryStampRequirement(
				config as Parameters<typeof factoryStampRequirement>[0],
				state as Parameters<typeof factoryStampRequirement>[1],
			),
		).toEqual({ required, reason });
	});

	describe("from the models the sessions reported", () => {
		const attempt = (
			role: "builder" | "reviewer",
			sessionId: string,
			modelId?: string,
		) => ({
			id: sessionId,
			key: role,
			role,
			repairRound: 0,
			createdAt: "2035-01-01T00:00:00.000Z",
			sessionId,
			instructions: "",
			// Configured on different models: only the recorded ones decide.
			agent: {
				modelSelection: {
					providerId: "x",
					modelId: role === "builder" ? "claude-sonnet" : "gpt-5",
				},
			},
			status: "completed" as const,
			summary: "",
			completedAt: "2035-01-01T00:00:00.000Z",
			...(modelId ? { sessionModel: { providerId: "cline", modelId } } : {}),
		});
		const stamp = (attempts: ReturnType<typeof attempt>[]) =>
			factoryStampRequirement(
				{ autonomy: "hands_off" },
				{ reviewSelection: local, attempts },
			);

		it("asks for a stamp when the reviewer ran on the builder's model", () => {
			expect(
				stamp([
					attempt("builder", "b", "anthropic/claude-sonnet-4"),
					attempt("reviewer", "r", "us.anthropic.claude-sonnet-4"),
				]),
			).toEqual({ required: true, reason: "reviewer model not independent" });
			expect(
				stamp([
					attempt("builder", "b", "anthropic/claude-sonnet-4"),
					attempt("reviewer", "r"),
				]),
			).toEqual({ required: true, reason: "reviewer model unknown" });
		});

		it("needs no stamp for a reviewer on another model, and keeps older runs as they were", () => {
			expect(
				stamp([
					attempt("builder", "b", "anthropic/claude-sonnet-4"),
					attempt("reviewer", "r", "openai/gpt-5"),
				]),
			).toEqual({ required: false, reason: "local change" });
			// No attempt recorded a model: the configured-model check stands.
			const older = [attempt("builder", "b"), attempt("reviewer", "r")];
			expect(factoryRecordedReviewIndependence({ attempts: older })).toBe(
				undefined,
			);
			expect(stamp(older)).toEqual({ required: false, reason: "local change" });
			expect(
				factoryRunStateSchema.parse({ ...runStateBase, attempts: older })
					.attempts?.[0],
			).not.toHaveProperty("sessionModel");
		});
	});
});

describe("factoryRepositoryRelative", () => {
	it("strips Factory worktree and workspace prefixes, leaving repository-relative paths", () => {
		const worktree =
			"/Users/me/data/db/factory/factory-worktrees/3122107af10795ac2f6b37cd/repo";
		expect(
			factoryRepositoryRelative(
				`Redundant gate call in ${worktree}/apps/desktop/sidecar/cloud-handoff.ts. See \`${worktree}/apps/a.ts:12\` and (${worktree}).`,
			),
		).toBe(
			"Redundant gate call in apps/desktop/sidecar/cloud-handoff.ts. See `apps/a.ts:12` and (.).",
		);
		expect(
			factoryRepositoryRelative(
				"C:\\data\\factory-worktrees\\abc\\repo\\src\\a.ts",
			),
		).toBe("src\\a.ts");
		expect(
			factoryRepositoryRelative("Edit /work/cline/apps/b.ts and /tmp/x", [
				"/work/cline/",
				undefined,
			]),
		).toBe("Edit apps/b.ts and /tmp/x");
		expect(
			factoryRepositoryRelative("/a/factory-worktrees/abc/repository/x"),
		).toBe("/a/factory-worktrees/abc/repository/x");
	});
});

describe("Factory short card ids", () => {
	it("formats and parses the sayable forms", () => {
		expect(formatFactoryId(42)).toBe("F42");
		for (const text of ["F42", "F-42", "f-42", "f42", "#42", " F42 "]) {
			expect(parseFactoryId(text)).toBe(42);
		}
		for (const text of [
			"",
			"F-",
			"F0",
			"42",
			"task_1700000000000_abc12",
			"F-4x",
		]) {
			expect(parseFactoryId(text)).toBeUndefined();
		}
	});
});

describe("Factory safety gates", () => {
	const selection = {
		impact: "local" as const,
		rationale: "One handler",
		affectedPaths: ["src/a.ts"],
		consumers: ["api"],
		planReviewerIndices: [0],
		reviewerIndices: [0, 1],
	};

	it("defines the built-in policy with a spending limit and derives a card's limit from it", () => {
		expect(FACTORY_BUILT_IN_POLICY).toEqual({
			autonomy: "hands_off",
			approval: "automatic",
			maxCostUsd: 10,
		});
		expect(factoryCardCostLimitUsd({ autonomy: "hands_off" })).toBe(10);
		expect(
			factoryCardCostLimitUsd({ autonomy: "hands_off", maxCostUsd: 3 }),
		).toBe(3);
		expect(factoryCardCostLimitUsd({})).toBeUndefined();
		expect(factorySpendingLimitReason(10)).toBe(
			"This card reached its $10 spending limit. Raise the limit or stop here.",
		);
		expect(
			factorySpendingLimitReason(2.5).startsWith(FACTORY_SPENDING_LIMIT_PREFIX),
		).toBe(true);
	});

	it("counts unknown usage against spending limits instead of zero", () => {
		// A session that never started cost nothing.
		expect(factorySessionCostUsd(undefined, false)).toBe(0);
		expect(
			factoryUnstartedSessionIds([
				{
					sessions: [{ sessionId: "ran", role: "builder" }],
					attempts: ["ran", "never", "done"].map((sessionId) => ({
						id: sessionId,
						key: "build",
						role: "builder" as const,
						repairRound: 0,
						createdAt: "2035-01-01T00:00:00.000Z",
						sessionId,
						instructions: "",
						agent: {},
						...(sessionId === "done"
							? { status: "completed" as const, summary: "", completedAt: "x" }
							: {
									status: "failed" as const,
									failure: "runtime" as const,
									error: "e",
									completedAt: "x",
								}),
					})),
				},
			]),
		).toEqual(new Set(["never"]));
		expect(factorySessionCostUsd(undefined)).toBe(
			FACTORY_UNKNOWN_SESSION_COST_USD,
		);
		const tokens = {
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
		expect(factorySessionCostUsd({ ...tokens, totalCost: 0.5 })).toBe(0.5);
		// Tokens without a price: a conservative estimate.
		expect(factorySessionCostUsd({ ...tokens, totalCost: 0 })).toBe(22.5);
		expect(
			factorySessionCostUsd({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			}),
		).toBe(0);
		expect(factoryDailySpendingLimitReason(50)).toContain(
			"$50 daily spending limit",
		);
	});

	it("keeps saved workflow revisions stable: the new switches have no defaults", () => {
		const config = factoryWorkflowConfigSchema.parse({});
		expect(config).not.toHaveProperty("requireIndependentReview");
		expect(config).not.toHaveProperty("minCodeReviewers");
		expect(config).not.toHaveProperty("repoRules");
		expect(
			factoryWorkflowConfigSchema.parse({
				requireIndependentReview: false,
				minCodeReviewers: 2,
				repoRules: true,
			}),
		).toMatchObject({
			requireIndependentReview: false,
			minCodeReviewers: 2,
			repoRules: true,
		});
	});

	it("treats hands-off cards without a review mode as adaptive and requiring independent review", () => {
		expect(factoryReviewMode({ autonomy: "hands_off" })).toBe("adaptive");
		expect(
			factoryReviewMode({ autonomy: "hands_off", reviewMode: "fixed" }),
		).toBe("fixed");
		expect(factoryReviewMode({})).toBe("fixed");
		expect(factoryRequiresIndependentReview({ autonomy: "hands_off" })).toBe(
			true,
		);
		expect(
			factoryRequiresIndependentReview({
				autonomy: "hands_off",
				requireIndependentReview: false,
			}),
		).toBe(false);
		expect(factoryRequiresIndependentReview({})).toBe(false);
	});

	it("finds an independent code reviewer only on a model family no author uses", () => {
		const card = { providerId: "anthropic", modelId: "claude-sonnet-4" };
		const other = { providerId: "openai", modelId: "gpt-5" };
		const same = factoryIndependentReview(DEFAULT_FACTORY_AGENTS, card);
		expect(same.independent).toBe(false);
		expect(same.reason).toContain("claude-sonnet-4");
		expect(
			factoryIndependentReview(
				{ ...DEFAULT_FACTORY_AGENTS, reviewers: [] },
				card,
			),
		).toEqual({
			independent: false,
			reason: "No code reviewer is configured.",
		});
		expect(
			factoryIndependentReview(
				{ ...DEFAULT_FACTORY_AGENTS, reviewers: [{ modelSelection: other }] },
				card,
			).independent,
		).toBe(true);
		// Router and vendor aliases of the builder's model are the same model.
		for (const alias of [
			{ providerId: "openrouter", modelId: "anthropic/claude-sonnet-4" },
			{
				providerId: "bedrock",
				modelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
			},
			{ providerId: "vertex", modelId: "Claude-Sonnet-4@20250514" },
		])
			expect(
				factoryIndependentReview(
					{ ...DEFAULT_FACTORY_AGENTS, reviewers: [{ modelSelection: alias }] },
					card,
				).independent,
			).toBe(false);
		// A plan reviewer on another model alone does not count.
		expect(
			factoryIndependentReview(
				{
					...DEFAULT_FACTORY_AGENTS,
					planReviewers: [{ modelSelection: other }],
				},
				card,
			).independent,
		).toBe(false);
		// Every implementer and the designer are authors.
		expect(
			factoryIndependentReview(
				{
					...DEFAULT_FACTORY_AGENTS,
					implementers: [{}, { modelSelection: other }],
					reviewers: [{ modelSelection: other }],
				},
				card,
			).independent,
		).toBe(false);
		expect(
			factoryIndependentReview(
				{
					...DEFAULT_FACTORY_AGENTS,
					designer: { modelSelection: other },
					reviewers: [{ modelSelection: other }],
				},
				card,
			).independent,
		).toBe(false);
		// A frozen profile's model is used.
		expect(
			factoryIndependentReview(
				{
					...DEFAULT_FACTORY_AGENTS,
					reviewers: [
						{
							profile: "critic",
							resolvedProfile: {
								name: "critic",
								description: "",
								systemPrompt: "",
								providerId: "openai",
								modelId: "gpt-5",
							},
						},
					],
				},
				card,
			).independent,
		).toBe(true);
		// Nothing names a model: no reviewer can be shown to differ.
		expect(
			factoryIndependentReview(DEFAULT_FACTORY_AGENTS, undefined).independent,
		).toBe(false);
		expect(factoryModelFamily("openrouter/anthropic/claude-x-latest")).toBe(
			"claude-x",
		);
	});

	it("parses a size rating, keeps older selections and never lets size and impact disagree", () => {
		expect(factoryReviewSelectionSchema.parse(selection)).not.toHaveProperty(
			"size",
		);
		expect(
			factoryReviewSize(factoryReviewSelectionSchema.parse(selection)),
		).toBe("local");
		expect(
			factoryReviewSelectionSchema.parse({ ...selection, size: "trivial" }),
		).toMatchObject({ impact: "local", size: "trivial" });
		// The larger rating wins for both fields.
		expect(
			factoryReviewSelectionSchema.parse({
				...selection,
				size: "cross_cutting",
			}),
		).toMatchObject({ impact: "cross_cutting", size: "cross_cutting" });
		expect(
			factoryReviewSelectionSchema.parse({
				...selection,
				impact: "shared_contract",
				size: "trivial",
			}),
		).toMatchObject({ impact: "shared_contract", size: "shared_contract" });
		expect(
			factoryReviewSelectionSchema.safeParse({
				...selection,
				size: "shared_contract",
				planReviewerIndices: [],
			}).success,
		).toBe(false);
	});

	it("scales participants and the repair budget with the size", () => {
		const pools = { planReviewers: 2, reviewers: 3 };
		const trivial = applyFactoryReviewSizePolicy(
			{ ...selection, size: "trivial" },
			pools,
		);
		expect(trivial).toMatchObject({
			impact: "local",
			size: "trivial",
			planReviewerIndices: [],
			reviewerIndices: [0],
		});
		expect(factoryRepairRounds({ maxRepairRounds: 5 }, trivial)).toBe(1);
		expect(
			factoryRepairRounds(
				{ maxRepairRounds: 5 },
				{ ...selection, size: "cross_cutting" },
			),
		).toBe(3);
		// Without a size the workflow's budget applies.
		expect(factoryRepairRounds({ maxRepairRounds: 5 }, selection)).toBe(5);
		// The workflow floor tops reviewers up from the pool in order.
		expect(
			applyFactoryReviewSizePolicy(
				{ ...selection, size: "local", reviewerIndices: [2] },
				pools,
				{ minCodeReviewers: 2 },
			).reviewerIndices,
		).toEqual([0, 2]);
		// Repair cannot lower an earlier round's size.
		expect(
			applyFactoryReviewSizePolicy({ ...selection, size: "trivial" }, pools, {
				floor: { impact: "shared_contract", size: "shared_contract" },
			}),
		).toMatchObject({
			size: "shared_contract",
			impact: "shared_contract",
			planReviewerIndices: [0],
			reviewerIndices: [0, 1],
		});
		// An unrated selection keeps its reviewers apart from the floor.
		expect(applyFactoryReviewSizePolicy(selection, pools)).toEqual(selection);
	});

	it("runs the verifier for small changes only when a criterion needs the running app", () => {
		const checked = [{ check: "Behavior" }];
		expect(factoryVerifierNeeded(undefined, checked)).toBe(true);
		expect(factoryVerifierNeeded(selection, checked)).toBe(true);
		expect(
			factoryVerifierNeeded({ ...selection, size: "trivial" }, checked),
		).toBe(false);
		expect(
			factoryVerifierNeeded({ ...selection, size: "local" }, [
				...checked,
				{ check: undefined },
			]),
		).toBe(true);
		expect(
			factoryVerifierNeeded(
				{ impact: "shared_contract", size: "shared_contract" },
				checked,
			),
		).toBe(true);
	});

	it("escalates a small rating whose diff outgrows its bounds, adding the reviewers the new size needs", () => {
		const diff = [
			"diff --git a/a.ts b/a.ts",
			"--- a/a.ts",
			"+++ b/a.ts",
			"+one",
			"-two",
			" context",
		].join("\n");
		expect(factoryDiffSize(diff)).toEqual({ changedFiles: 1, changedLines: 2 });
		const trivial = {
			...selection,
			size: "trivial" as const,
			reviewerIndices: [1],
		};
		expect(
			factoryReviewSizeEscalation({
				selection: trivial,
				changedFiles: 3,
				changedLines: 40,
				reviewerPool: 3,
			}),
		).toBeUndefined();
		expect(
			factoryReviewSizeEscalation({
				selection: trivial,
				changedFiles: 4,
				changedLines: 10,
				reviewerPool: 3,
			}),
		).toMatchObject({ size: "local", reviewerIndices: [1] });
		const escalated = factoryReviewSizeEscalation({
			selection: trivial,
			changedFiles: 20,
			changedLines: 900,
			reviewerPool: 3,
		});
		expect(escalated).toMatchObject({
			size: "shared_contract",
			reviewerIndices: [0, 1],
		});
		expect(escalated?.rationale).toContain("900 lines in 20 files");
		// Larger ratings are never escalated by size.
		expect(
			factoryReviewSizeEscalation({
				selection: { ...selection, impact: "shared_contract" },
				changedFiles: 99,
				changedLines: 9999,
				reviewerPool: 3,
			}),
		).toBeUndefined();
	});

	it("never rates changes to sensitive paths below shared contract", () => {
		expect(
			factorySensitivePaths([
				"src/auth/session.ts",
				"src/billing/invoice.ts",
				".env.local",
				"config/secrets.yaml",
				".github/workflows/ci.yml",
				"package.json",
				"bun.lock",
				"db/migrations/001_init.sql",
				"src/components/button.tsx",
				"docs/authoring.md",
			]),
		).toEqual([
			"src/auth/session.ts",
			"src/billing/invoice.ts",
			".env.local",
			"config/secrets.yaml",
			".github/workflows/ci.yml",
			"package.json",
			"bun.lock",
			"db/migrations/001_init.sql",
		]);
		const lockfile = {
			...selection,
			size: "trivial" as const,
			affectedPaths: ["package.json"],
			planReviewerIndices: [],
			reviewerIndices: [0],
		};
		const raised = applyFactoryReviewSizePolicy(lockfile, {
			planReviewers: 1,
			reviewers: 2,
		});
		expect(raised).toMatchObject({
			size: "shared_contract",
			impact: "shared_contract",
			planReviewerIndices: [0],
			reviewerIndices: [0, 1],
		});
		expect(raised.rationale).toContain("sensitive paths (package.json)");
		expect(factoryReviewSelectionSchema.safeParse(raised).success).toBe(true);
		// Pools that cannot staff it leave the rating; a person stamps instead.
		const unstaffed = applyFactoryReviewSizePolicy(lockfile, {
			planReviewers: 0,
			reviewers: 1,
		});
		expect(unstaffed.size).toBe("trivial");
		expect(
			factoryStampRequirement(
				{ autonomy: "hands_off" },
				{ reviewSelection: unstaffed },
			),
		).toEqual({ required: true, reason: "sensitive paths" });
		// After the build, a sensitive change escalates and says which reviewers to add.
		expect(
			factoryReviewSizeEscalation({
				selection: { ...selection, size: "trivial", reviewerIndices: [1] },
				changedFiles: 1,
				changedLines: 2,
				changedPaths: [".github/workflows/release.yml"],
				reviewerPool: 3,
			}),
		).toMatchObject({
			size: "shared_contract",
			reviewerIndices: [0, 1],
			addedReviewerIndices: [0],
		});
	});

	it("persists the loop counters with the run and design state", () => {
		expect(FACTORY_MAX_INTERRUPT_RECOVERIES).toBe(2);
		expect(FACTORY_MAX_PLAN_FAULT_REDESIGNS).toBe(2);
		expect(FACTORY_MAX_AGENT_RETRIES).toBe(2);
		const workspace = {
			path: "/w",
			branch: "b",
			baseBranch: "main",
			baseCommit: "c",
		};
		expect(
			factoryRunStateSchema.parse({
				phase: "implementing",
				repairRound: 0,
				workspace,
				sessions: [],
				priorCardCostUsd: 1.5,
				agentRetries: 1,
			}),
		).toMatchObject({ priorCardCostUsd: 1.5, agentRetries: 1 });
		expect(
			factoryDesignProgressSchema.parse({
				phase: "designing",
				revision: 1,
				repairRound: 0,
				agents: DEFAULT_FACTORY_AGENTS,
				designerSessionId: "d",
				findings: [],
				planFaultRedesigns: 2,
			}).planFaultRedesigns,
		).toBe(2);
	});
});

describe("factoryPreparedScopeProblems", () => {
	const check = {
		name: "Typo fixed",
		kind: "test" as const,
		command: "grep -q hello src/a.txt",
		artifacts: [],
	};
	const criterion = {
		id: "fixed",
		text: "Fixed",
		required: true,
		check: "Typo fixed",
	};

	it("accepts a plan whose every criterion names one of its checks", () => {
		expect(
			factoryPreparedScopeProblems(
				{ checks: [check], acceptanceCriteria: [criterion] },
				"/repo",
			),
		).toEqual([]);
	});

	it("names each reason a supplied plan cannot be used as it is", () => {
		expect(
			factoryPreparedScopeProblems({ checks: [], acceptanceCriteria: [] }),
		).toEqual([
			"The plan lists no checks.",
			"The plan lists no acceptance criteria.",
		]);
		const problems = factoryPreparedScopeProblems(
			{
				checks: [check, { ...check, command: "grep -q hello /repo/src/a.txt" }],
				acceptanceCriteria: [
					criterion,
					{ id: "other", text: "Other", required: true },
				],
			},
			"/repo",
		);
		expect(problems).toContain("Check names must be unique.");
		expect(problems.join("\n")).toContain("references the original checkout");
		expect(problems.join("\n")).toContain(
			'Acceptance criterion "other" needs a named approved check',
		);
	});
});
