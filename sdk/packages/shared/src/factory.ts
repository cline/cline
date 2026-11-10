import { z } from "zod";

export const factoryAgentSchema = z.object({
	profile: z.string().trim().min(1).optional(),
	skills: z.array(z.string().trim().min(1)).max(100).optional(),
	tools: z.array(z.string().trim().min(1)).max(100).optional(),
	resolvedProfile: z
		.object({
			name: z.string(),
			description: z.string(),
			systemPrompt: z.string(),
			tools: z.array(z.string()).optional(),
			skills: z.array(z.string()).optional(),
			providerId: z.string().optional(),
			modelId: z.string().optional(),
			maxIterations: z.number().int().positive().optional(),
			path: z.string().optional(),
		})
		.optional(),
	modelSelection: z
		.object({
			providerId: z.string().trim().min(1),
			modelId: z.string().trim().min(1),
		})
		.optional(),
	instructions: z.string().max(20_000).optional(),
	maxIterations: z.number().int().min(1).max(1000).optional(),
	timeoutSeconds: z.number().int().min(1).max(7200).optional(),
});
export type FactoryAgent = z.infer<typeof factoryAgentSchema>;

export const factoryAgentsSchema = z.object({
	designer: factoryAgentSchema.default({}),
	planReviewers: z.array(factoryAgentSchema).max(4).default([]),
	implementer: factoryAgentSchema.default({}),
	verifier: factoryAgentSchema
		.extend({ artifacts: z.array(z.string().trim().min(1)).max(20).optional() })
		.optional(),
	reviewers: z.array(factoryAgentSchema).min(1).max(4).default([{}]),
});
export type FactoryAgents = z.infer<typeof factoryAgentsSchema>;
export const DEFAULT_FACTORY_AGENTS: FactoryAgents = factoryAgentsSchema.parse(
	{},
);

export const factoryCheckSchema = z.object({
	name: z.string().trim().min(1).max(200),
	command: z.string().trim().min(1).max(10_000),
	kind: z.enum(["test", "api", "ui"]),
	artifacts: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const factoryImplementationUnitsSchema = z
	.array(
		z.object({
			id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
			instructions: z.string().trim().min(1).max(20_000),
			dependsOn: z.array(z.string()).max(3).default([]),
		}),
	)
	.min(1)
	.max(4)
	.superRefine((units, context) => {
		const preceding = new Set<string>();
		for (const unit of units) {
			if (
				preceding.has(unit.id) ||
				unit.dependsOn.some((id) => !preceding.has(id))
			)
				context.addIssue({
					code: "custom",
					message:
						"Unit IDs must be unique and dependencies must name preceding units",
				});
			preceding.add(unit.id);
		}
	});

export const factoryTaskConfigSchema = z.object({
	implementationUnits: factoryImplementationUnitsSchema.optional(),
	agents: factoryAgentsSchema.optional(),
	execution: z.enum(["local", "cloud"]).default("local"),
	approval: z.enum(["required", "automatic"]).default("required"),
	maxCostUsd: z.number().positive().optional(),
	maxRuntimeRetries: z.number().int().min(0).max(5).optional(),
	maxRepairRounds: z.number().int().min(0).max(10).default(2),
	checks: z.array(factoryCheckSchema).max(20).default([]),
	publishPullRequest: z.boolean().default(false),
	watchPullRequest: z.boolean().optional(),
	documents: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(200),
				content: z.string().max(100_000),
			}),
		)
		.max(10)
		.optional(),
	sourceIssue: z
		.object({
			provider: z.enum(["github", "linear"]),
			id: z.string().min(1).max(500),
			url: z.string().url(),
		})
		.optional(),
});

export type FactoryTaskConfig = z.infer<typeof factoryTaskConfigSchema>;
export type FactoryCheck = z.infer<typeof factoryCheckSchema>;

export const factoryArtifactSchema = z.object({
	label: z.string(),
	path: z.string(),
	mimeType: z.string(),
});
export type FactoryArtifact = z.infer<typeof factoryArtifactSchema>;

export const factoryCheckResultSchema = z.object({
	name: z.string(),
	kind: factoryCheckSchema.shape.kind,
	command: z.string(),
	status: z.enum(["passed", "failed", "blocked"]),
	exitCode: z.number().int().nullable(),
	output: z.string(),
	artifacts: z.array(factoryArtifactSchema),
});
export type FactoryCheckResult = z.infer<typeof factoryCheckResultSchema>;

export const factoryReviewSchema = z.object({
	verdict: z.enum(["pass", "changes_requested"]),
	summary: z.string().min(1),
	findings: z.array(z.string().min(1)),
	coverage: z
		.object({
			static: z.array(z.string()),
			exercised: z.array(z.string()),
			unverified: z.array(z.string()),
		})
		.optional(),
});

export type FactoryReview = z.infer<typeof factoryReviewSchema>;

export const factoryReviewerResultSchema = z.object({
	reviewerIndex: z.number().int().nonnegative(),
	sessionId: z.string(),
	review: factoryReviewSchema,
});
export type FactoryReviewerResult = z.infer<typeof factoryReviewerResultSchema>;

export const factoryDesignReviewSchema = z.object({
	revision: z.number().int().positive(),
	reviews: z.array(factoryReviewerResultSchema),
});
export type FactoryDesignReview = z.infer<typeof factoryDesignReviewSchema>;

export const factoryCandidateSchema = z.object({
	commit: z.string(),
	checks: z.array(factoryCheckResultSchema),
	reviews: z.array(factoryReviewerResultSchema),
	verification: z
		.object({
			sessionId: z.string(),
			review: factoryReviewSchema,
			artifacts: z.array(factoryArtifactSchema),
		})
		.optional(),
});
export type FactoryCandidate = z.infer<typeof factoryCandidateSchema>;

export const factoryWorkspaceSchema = z.object({
	path: z.string(),
	branch: z.string(),
	baseBranch: z.string(),
	baseCommit: z.string(),
});
export type FactoryWorkspace = z.infer<typeof factoryWorkspaceSchema>;

export const factoryUsageSchema = z.object({
	inputTokens: z.number().nonnegative(),
	outputTokens: z.number().nonnegative(),
	cacheReadTokens: z.number().nonnegative(),
	cacheWriteTokens: z.number().nonnegative(),
	totalCost: z.number().nonnegative(),
});
const factoryAttemptBaseSchema = z.object({
	id: z.string(),
	usage: factoryUsageSchema.optional(),
	key: z.string(),
	role: z.enum(["builder", "reviewer", "verifier"]),
	repairRound: z.number().int().nonnegative(),
	workspace: factoryWorkspaceSchema.optional(),
	createdAt: z.string(),
	sessionId: z.string(),
	instructions: z.string(),
	agent: factoryAgentSchema,
});
export const factoryAttemptSchema = z.discriminatedUnion("status", [
	factoryAttemptBaseSchema.extend({ status: z.literal("intent") }),
	factoryAttemptBaseSchema.extend({ status: z.literal("running") }),
	factoryAttemptBaseSchema.extend({
		status: z.literal("completed"),
		summary: z.string(),
		completedAt: z.string(),
	}),
	factoryAttemptBaseSchema.extend({
		status: z.literal("failed"),
		failure: z.enum(["runtime", "output"]),
		error: z.string(),
		completedAt: z.string(),
	}),
]);
export type FactoryAttempt = z.infer<typeof factoryAttemptSchema>;

export const factoryPullRequestChecksSchema = z.object({
	headCommit: z.string(),
	status: z.enum(["passed", "pending", "failed", "unknown"]),
	checks: z.array(
		z.object({
			name: z.string(),
			status: z.enum(["pass", "fail", "pending", "skipping", "cancel"]),
		}),
	),
});
export type FactoryPullRequestChecks = z.infer<
	typeof factoryPullRequestChecksSchema
>;

export const factoryRunStateSchema = z.object({
	verificationRetry: z.number().int().nonnegative().optional(),
	verificationFeedback: z
		.object({
			commit: z.string(),
			verifier: z.array(z.string()),
			reviewers: z.array(
				z.object({
					reviewerIndex: z.number().int().nonnegative(),
					gaps: z.array(z.string()),
				}),
			),
		})
		.optional(),
	implementationIntegrated: z.boolean().optional(),
	integrationRepairs: z
		.array(
			z.object({ key: z.string(), status: z.enum(["running", "checked"]) }),
		)
		.optional(),
	humanApproval: z
		.object({ commit: z.string(), approvedAt: z.string() })
		.optional(),
	audit: z
		.object({
			selectedAt: z.string(),
			selectionReason: z.enum(["manual", "random"]).optional(),
			finding: z.string().optional(),
			reviewedAt: z.string().optional(),
		})
		.optional(),
	sessionUsage: z
		.array(
			z.object({ sessionId: z.string(), usage: factoryUsageSchema.optional() }),
		)
		.optional(),
	pullRequestChecks: factoryPullRequestChecksSchema.optional(),
	usage: z
		.object({
			totals: factoryUsageSchema,
			unknownSessionIds: z.array(z.string()),
		})
		.optional(),
	implementationUnits: z
		.array(
			z.discriminatedUnion("status", [
				z.object({
					id: z.string(),
					workspace: factoryWorkspaceSchema,
					status: z.literal("implementing"),
				}),
				z.object({
					id: z.string(),
					workspace: factoryWorkspaceSchema,
					status: z.literal("completed"),
					commit: z.string(),
				}),
			]),
		)
		.optional(),
	agents: factoryAgentsSchema.optional(),
	attempts: z.array(factoryAttemptSchema).optional(),
	candidateHistory: z.array(factoryCandidateSchema).optional(),
	repairInstructions: z.string().optional(),
	verifierBaseline: z
		.object({ key: z.string(), versions: z.array(z.string().nullable()) })
		.optional(),
	phase: z.enum([
		"implementing",
		"verifying",
		"reviewing",
		"repairing",
		"publishing",
		"ready",
		"blocked",
		"watching",
	]),
	repairRound: z.number().int().nonnegative(),
	workspace: factoryWorkspaceSchema,
	sessions: z.array(
		z.object({
			sessionId: z.string(),
			role: z.enum(["builder", "reviewer", "verifier"]),
		}),
	),
	candidate: factoryCandidateSchema.optional(),
	pullRequestUrl: z.string().optional(),
	pullRequestWatch: z
		.object({
			headCommit: z.string(),
			paused: z.boolean().optional(),
			handledFeedbackIds: z.array(z.string()),
			pending: z
				.object({
					feedbackIds: z.array(z.string()),
					instructions: z.string(),
					phase: z.enum(["repair", "publish", "blocked"]),
				})
				.optional(),
		})
		.optional(),
	error: z.string().optional(),
});
export type FactoryRunState = z.infer<typeof factoryRunStateSchema>;
