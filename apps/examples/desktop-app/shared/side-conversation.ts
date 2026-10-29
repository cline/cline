import { z } from "zod";

export const DESKTOP_SIDE_REFERENCE_KIND = "desktop_side_reference";

const SideOwnerSchema = z.object({
	runId: z.string().min(1),
	pid: z.number().int().positive(),
	startToken: z.string().nullable(),
});
const SideConversationSchema = z.object({
	version: z.union([z.literal(1), z.literal(2)]),
	parentSessionId: z.string().min(1),
	owner: SideOwnerSchema.optional(),
});
export type SideConversation = z.infer<typeof SideConversationSchema>;

export const SIDE_REFERENCE_BUDGET_BYTES = 16 * 1024;
export const SIDE_EXCERPT_BUDGET_BYTES = 4 * 1024;
export const SIDE_VISIBLE_BUDGET_BYTES = 24 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const referenceByteLength = (text: string) =>
	encoder.encode(text).length;

export function referenceExcerpt(
	text: string,
	budget = SIDE_EXCERPT_BUDGET_BYTES,
) {
	const bytes = encoder.encode(text);
	if (bytes.length <= budget) return { text, omittedBytes: 0 };
	const room = Math.max(0, budget - 96);
	let head = Math.floor(room / 2);
	while (head > 0 && (bytes[head] & 0xc0) === 0x80) head--;
	let tail = bytes.length - Math.floor(room / 2);
	while (tail < bytes.length && (bytes[tail] & 0xc0) === 0x80) tail++;
	const omittedBytes = tail - head;
	return {
		text: `${decoder.decode(bytes.subarray(0, head))}\n[excerpt: ${omittedBytes} UTF-8 bytes omitted]\n${decoder.decode(bytes.subarray(tail))}`,
		omittedBytes,
	};
}

export function sanitizeReferenceText(text: string): string {
	return text
		.replace(/cline:\/\/cache\/[^\s"'<>]+/g, "[parent cache handle omitted]")
		.replace(
			/data:(?:image|audio|video)\/[^\s"'<>]+/g,
			"[binary media omitted]",
		);
}

export function serializeReferenceData(
	value: unknown,
	onOmittedMedia?: () => void,
): string {
	return sanitizeReferenceText(
		JSON.stringify(value, (_key, item: unknown) => {
			if (item && typeof item === "object" && "type" in item) {
				if (["image", "media", "file"].includes(String(item.type))) {
					onOmittedMedia?.();
					return "[media omitted]";
				}
				if (item.type === "thinking" || item.type === "redacted_thinking")
					return "[provider reasoning omitted]";
			}
			return item;
		}) ?? "",
	);
}

const VisibleExcerptSchema = z.object({
	messageId: z.string().min(1).max(512),
	role: z.enum(["user", "assistant", "tool"]),
	text: z
		.string()
		.refine((text) => referenceByteLength(text) <= SIDE_EXCERPT_BUDGET_BYTES),
	runCount: z.number().int().positive().optional(),
	submission: z.enum(["observed", "unconfirmed"]),
	omittedBytes: z.number().int().nonnegative(),
});
export const SideVisibleContextSchema = z
	.object({
		sessionId: z.string().min(1).max(512),
		environmentId: z.string().min(1).max(512),
		capturedAt: z.string().datetime(),
		excerpts: z.array(VisibleExcerptSchema).max(12),
		omittedExcerptCount: z.number().int().nonnegative(),
		omittedMediaCount: z.number().int().nonnegative(),
	})
	.refine(
		(value) =>
			referenceByteLength(JSON.stringify(value)) <= SIDE_VISIBLE_BUDGET_BYTES,
	);
export type SideVisibleContext = z.infer<typeof SideVisibleContextSchema>;

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
	config: z.record(z.unknown()),
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
		desktopSideConversation: SideConversationSchema.extend({
			version: z.literal(2),
			owner: SideOwnerSchema,
		}),
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
