import { z } from "zod/v4";
import { SideVisibleContextSchema } from "@cline/shared/browser";

const SideOwnerSchema = z.object({
	runId: z.string().min(1),
	pid: z.number().int().positive(),
	startToken: z.string().nullable(),
});
const SideConversationSchema = z.object({
	version: z.literal(2),
	parentSessionId: z.string().min(1),
	owner: SideOwnerSchema,
});
export type SideConversation = z.infer<typeof SideConversationSchema>;

const SideMetadataSchema = z.object({
	desktopSideConversation: SideConversationSchema,
});
export function readSideConversation(
	metadata: unknown,
): SideConversation | undefined {
	const result = SideMetadataSchema.safeParse(metadata);
	return result.success ? result.data.desktopSideConversation : undefined;
}

export function parseSideCommand(
	prompt: string,
): { question: string } | undefined {
	const match = /^\/(?:btw|side)(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
	return match ? { question: match[1]?.trim() ?? "" } : undefined;
}

export const SideConfigSchema = z.object({
	selectionSource: z.enum(["main", "side"]).optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	thinking: z.boolean().optional(),
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
	mode: z.enum(["act", "plan", "yolo"]),
	autoApproveTools: z.boolean(),
	enableTools: z.boolean(),
	rules: z.string().optional(),
	systemPrompt: z.string().optional(),
});
export type SideConfig = z.infer<typeof SideConfigSchema>;
export function readSideConfig(metadata: unknown): SideConfig | undefined {
	const result = z
		.object({ desktopSideConfig: SideConfigSchema })
		.safeParse(metadata);
	return result.success ? result.data.desktopSideConfig : undefined;
}

export const CreateSideConversationRequestSchema = z.object({
	action: z.literal("create_side"),
	sessionId: z.string().min(1),
	newSessionId: z.string().uuid(),
	config: z.record(z.string(), z.unknown()),
	visibleContext: SideVisibleContextSchema.optional(),
});
export const CreateSideConversationResultSchema = z.object({
	sessionId: z.string(),
	cwd: z.string(),
	workspaceRoot: z.string(),
	environmentId: z.string(),
	provider: z.string(),
	model: z.string(),
	mode: SideConfigSchema.shape.mode,
	autoApproveTools: z.boolean(),
	enableTools: z.boolean(),
	metadata: z.object({
		title: z.string(),
		desktopSideConversation: SideConversationSchema,
		desktopSideConfig: SideConfigSchema,
	}),
});
export type CreateSideConversationResult = z.infer<
	typeof CreateSideConversationResultSchema
>;

export function sideConversationTitle(metadata: unknown): string | undefined {
	if (!readSideConversation(metadata)) return undefined;
	const result = z
		.object({ title: z.string().trim().min(1) })
		.safeParse(metadata);
	return result.success ? result.data.title : undefined;
}
