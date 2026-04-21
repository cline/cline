import { z } from "zod";

export const ChatSessionConfigSchema = z.object({
	sessionId: z.string().min(1).optional(),
	workspaceRoot: z.string().min(1),
	cwd: z.string().optional(),
	provider: z.string().min(1),
	model: z.string().min(1),
	mode: z.enum(["act", "plan"]).default("act"),
	apiKey: z.string(),
	systemPrompt: z.string().optional(),
	rules: z.string().optional(),
	maxIterations: z.number().int().positive().optional(),
	enableTools: z.boolean(),
	enableSpawn: z.boolean(),
	enableTeams: z.boolean(),
	autoApproveTools: z.boolean().optional(),
	teamName: z.string().min(1),
	missionStepInterval: z.number().int().positive(),
	missionTimeIntervalMs: z.number().int().positive(),
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

export const ChatMessageSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().nullable(),
	role: ChatMessageRoleSchema,
	content: z.string(),
	reasoning: z.string().optional(),
	reasoningRedacted: z.boolean().optional(),
	createdAt: z.number().int().nonnegative(),
	meta: z
		.object({
			stream: z.enum(["stdout", "stderr"]).optional(),
			toolName: z.string().optional(),
			iteration: z.number().int().nonnegative().optional(),
			agentId: z.string().optional(),
			conversationId: z.string().optional(),
			hookEventName: z.string().optional(),
			messageKind: z.string().optional(),
			displayRole: z.string().optional(),
			reason: z.string().optional(),
			inputTokens: z.number().int().nonnegative().optional(),
			outputTokens: z.number().int().nonnegative().optional(),
			totalCost: z.number().nonnegative().optional(),
			providerId: z.string().optional(),
			modelId: z.string().optional(),
			checkpoint: z
				.object({
					ref: z.string(),
					createdAt: z.number().int().nonnegative(),
					runCount: z.number().int().positive(),
					kind: z.enum(["stash", "commit"]).optional(),
				})
				.optional(),
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
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
export type ChatViewState = z.infer<typeof ChatViewStateSchema>;
