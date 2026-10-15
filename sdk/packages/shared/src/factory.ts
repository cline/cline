import { z } from "zod";

export const factoryAgentSchema = z.object({
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

export const factoryTaskConfigSchema = z.object({
	agents: factoryAgentsSchema.optional(),
	execution: z.enum(["local", "cloud"]).default("local"),
	approval: z.enum(["required", "automatic"]).default("required"),
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

export const factoryRunStateSchema = z.object({
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
