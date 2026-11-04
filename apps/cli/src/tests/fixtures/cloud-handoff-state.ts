import { z } from "zod";

const draftSchema = z.object({
	instruction: z.string(),
	images: z.array(z.string()),
});

export const fixtureStateSchema = z.object({
	preparations: z
		.array(z.object({ sessionId: z.string(), draft: draftSchema }))
		.optional(),
	completedTaskIds: z.array(z.string()).optional(),
	retryTargets: z.array(draftSchema.extend({ taskId: z.string() })).optional(),
	started: z.boolean().optional(),
	localPrompts: z.array(z.string()).optional(),
	activeSessionId: z.string().optional(),
	resumeCalls: z.array(z.string()).optional(),
	attachedSessions: z.array(z.string()).optional(),
	attachAttempts: z.array(z.string()).optional(),
	abortedSessions: z.array(z.string()).optional(),
	acceptedCloudSends: z
		.array(
			z.object({
				prompt: z.string(),
				delivery: z.enum(["queue", "steer"]).optional(),
			}),
		)
		.optional(),
	settledCloudSends: z.array(z.string()).optional(),
	lateSnapshotsEmitted: z.number().optional(),
	runningChanges: z.array(z.boolean()).optional(),
	localSettled: z.boolean().optional(),
	localDoneEmitted: z.boolean().optional(),
	modeChangeCalls: z.number().optional(),
	removedSessions: z.array(z.string()).optional(),
	openedUrls: z.array(z.string()).optional(),
	cloudSends: z
		.array(
			z.object({
				sessionId: z.string(),
				modelId: z.string(),
				prompt: z.string(),
				delivery: z.enum(["queue", "steer"]).optional(),
				images: z.array(z.string()).optional(),
			}),
		)
		.optional(),
});

export type FixtureState = z.infer<typeof fixtureStateSchema>;
export type FixtureScenario =
	| "github-disconnected"
	| "success"
	| "failure"
	| "warning"
	| "held-success"
	| "held-failure"
	| "held-cloud-send"
	| "held-local-completion"
	| "held-local-attach-failure"
	| "removed-cloud-session"
	| "retry"
	| "attach-failure"
	| "approval";
