import { z } from "zod";

export const factoryCheckSchema = z.object({
	name: z.string().trim().min(1).max(200),
	command: z.string().trim().min(1).max(10_000),
	kind: z.enum(["test", "api", "ui"]),
	artifacts: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const factoryTaskConfigSchema = z.object({
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
});

export type FactoryReview = z.infer<typeof factoryReviewSchema>;

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
		z.object({ sessionId: z.string(), role: z.enum(["builder", "reviewer"]) }),
	),
	candidateCommit: z.string().optional(),
	checks: z.array(factoryCheckResultSchema),
	review: factoryReviewSchema.optional(),
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
