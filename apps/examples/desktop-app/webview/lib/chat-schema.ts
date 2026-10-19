import {
	GeneratedMediaSchema,
	type ProviderAuthInfo,
} from "@cline/shared/browser";
import { z } from "zod";

export const ProviderAuthInfoSchema = z.object({
	providerId: z.string(),
	capabilities: z.array(z.string()).optional(),
	localCli: z
		.object({ command: z.string(), docsUrl: z.string().optional() })
		.optional(),
	apiKeyOptional: z.boolean().optional(),
}) satisfies z.ZodType<ProviderAuthInfo>;

export const ChatSessionConfigSchema = z.object({
	sessionId: z.string().min(1).optional(),
	executionTarget: z.enum(["local", "cloud"]).default("local"),
	repoUrl: z.string().optional(),
	branch: z.string().optional(),
	workspaceRoot: z.string(),
	cwd: z.string().optional(),
	environmentId: z.string().trim().min(1),
	provider: z.string().min(1),
	providerAuth: ProviderAuthInfoSchema.optional(),
	model: z.string().min(1),
	mode: z.enum(["act", "plan"]).default("act"),
	apiKey: z.string(),
	systemPrompt: z.string().optional(),
	rules: z.string().optional(),
	maxIterations: z.number().int().positive().optional(),
	thinking: z.boolean().optional(),
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
	enableTools: z.boolean(),
	autoApproveTools: z.boolean().optional(),
	missionStepInterval: z.number().int().positive().optional(),
	missionTimeIntervalMs: z.number().int().positive().optional(),
});

export const ChatSessionStatusSchema = z.enum([
	"idle",
	"starting",
	"running",
	"stopping",
	"completed",
	"cancelled",
	"failed",
	"error",
]);

export const ChatMessageRoleSchema = z.enum([
	"user",
	"assistant",
	"tool",
	"system",
	"status",
	"error",
]);

export const ChatMessageImageSchema = z.object({
	id: z.string().min(1),
	mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
	data: z.string().min(1),
});

export const ChatMessageMediaSchema = GeneratedMediaSchema;

/**
 * One frame the agent captured while verifying its own work in the sandbox
 * ("close the loop"): a screenshot of the running app/CLI plus what the agent
 * did to get there and what it concluded.
 */
export const WorkVerificationScreenshotSchema = z.object({
	id: z.string().min(1),
	/** Host-resolved image URL (artifact URL, blob URL, or data URL). */
	src: z.string().min(1),
	title: z.string().min(1),
	note: z.string().optional(),
	action: z
		.enum(["launch", "screenshot", "click", "type", "scroll", "key", "resize"])
		.optional(),
	outcome: z.enum(["pass", "fail", "info"]).optional(),
});

export const WorkVerificationSchema = z.object({
	summary: z.string().min(1),
	/** What was exercised, e.g. a dev-server URL or a CLI binary name. */
	target: z.string().optional(),
	durationMs: z.number().int().nonnegative().optional(),
	screenshots: z.array(WorkVerificationScreenshotSchema).min(1),
});

export const ChatMessageSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().nullable(),
	role: ChatMessageRoleSchema,
	content: z.string(),
	images: z.array(ChatMessageImageSchema).optional(),
	media: z.array(ChatMessageMediaSchema).optional(),
	reasoning: z.string().optional(),
	reasoningRedacted: z.boolean().optional(),
	createdAt: z.number().int().nonnegative(),
	meta: z
		.object({
			stream: z.enum(["stdout", "stderr"]).optional(),
			toolName: z.string().optional(),
			toolCallId: z.string().optional(),
			toolOutput: z.string().optional(),
			toolOutputTruncated: z.boolean().optional(),
			toolDetachable: z.boolean().optional(),
			iteration: z.number().int().nonnegative().optional(),
			agentId: z.string().optional(),
			conversationId: z.string().optional(),
			hookEventName: z.string().optional(),
			messageKind: z.string().optional(),
			displayRole: z.string().optional(),
			reason: z.string().optional(),
			inputTokens: z.number().int().nonnegative().optional(),
			outputTokens: z.number().int().nonnegative().optional(),
			cacheReadTokens: z.number().int().nonnegative().optional(),
			totalCost: z.number().nonnegative().optional(),
			providerId: z.string().optional(),
			providerAuth: ProviderAuthInfoSchema.optional(),
			modelId: z.string().optional(),
			userRunSpan: z.number().int().nonnegative().optional(),
			runCount: z.number().int().positive().optional(),
			checkpoint: z
				.object({
					ref: z.string(),
					createdAt: z.number().int().nonnegative(),
					runCount: z.number().int().positive(),
					kind: z.enum(["stash", "commit"]).optional(),
				})
				.optional(),
			verification: WorkVerificationSchema.optional(),
		})
		.optional(),
});

export const ChatSummarySchema = z.object({
	toolCalls: z.number().int().nonnegative(),
	tokensIn: z.number().int().nonnegative(),
	tokensOut: z.number().int().nonnegative(),
});

export const ChatViewStateSchema = z.object({
	sessionId: z.string().nullable(),
	status: ChatSessionStatusSchema,
	config: ChatSessionConfigSchema,
	messages: z.array(ChatMessageSchema),
	rawTranscript: z.string(),
	error: z.string().nullable(),
	summary: ChatSummarySchema,
});

export type ChatSessionConfig = z.infer<typeof ChatSessionConfigSchema>;
export type ChatSessionStatus = z.infer<typeof ChatSessionStatusSchema>;
export type ChatMessageImage = z.infer<typeof ChatMessageImageSchema>;
export type ChatMessageMedia = z.infer<typeof ChatMessageMediaSchema>;
export type WorkVerificationScreenshot = z.infer<
	typeof WorkVerificationScreenshotSchema
>;
export type WorkVerification = z.infer<typeof WorkVerificationSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
export type ChatViewState = z.infer<typeof ChatViewStateSchema>;
