import { z } from "zod";

export const WorkspaceIsolationModeSchema = z.enum([
	"shared_readonly",
	"path_disjoint",
	"worktree_isolated",
]);
export type WorkspaceIsolationMode = z.infer<
	typeof WorkspaceIsolationModeSchema
>;

export const SeedWorkspaceSchema = z
	.object({
		mode: WorkspaceIsolationModeSchema,
		cwd: z.string().min(1).optional(),
		worktreePath: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.mode === "worktree_isolated" && !value.worktreePath) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "worktree_isolated requires worktreePath",
				path: ["worktreePath"],
			});
		}
	});
export type SeedWorkspace = z.infer<typeof SeedWorkspaceSchema>;

export const SeedPacketSchema = z
	.object({
		doItemId: z.string().min(1),
		title: z.string().min(1),
		goal: z.string(),
		parentBriefing: z.string(),
		assigneeParticipantId: z.string().min(1),
		allowedPathPrefixes: z.array(z.string()),
		linkedShowTemplateIds: z.array(z.string()),
		workspace: SeedWorkspaceSchema,
		parentSessionId: z.string().min(1),
	})
	.strict();
export type SeedPacket = z.infer<typeof SeedPacketSchema>;

export const PromoteStatusSchema = z.enum(["done", "failed", "cancelled"]);
export type PromoteStatus = z.infer<typeof PromoteStatusSchema>;

export const PromotePacketSchema = z
	.object({
		workerSessionId: z.string().min(1),
		doItemId: z.string().min(1),
		status: PromoteStatusSchema,
		summary: z.string(),
		decisions: z.array(z.string()),
		showItemIds: z.array(z.string()),
		eventRefs: z.array(z.string()),
		auditHandle: z.string().min(1),
		retainForAudit: z.boolean(),
	})
	.strict();
export type PromotePacket = z.infer<typeof PromotePacketSchema>;

export const ChatForkLifecycleStateSchema = z.enum([
	"seeded",
	"running",
	"promoting",
	"archived",
	"dropped",
	"auditing",
]);
export type ChatForkLifecycleState = z.infer<
	typeof ChatForkLifecycleStateSchema
>;

export const ChatForkRecordSchema = z
	.object({
		workerSessionId: z.string().min(1),
		lifecycle: ChatForkLifecycleStateSchema,
		seed: SeedPacketSchema,
		promote: PromotePacketSchema.nullable(),
		visibleToHuman: z.boolean(),
	})
	.strict();
export type ChatForkRecord = z.infer<typeof ChatForkRecordSchema>;

export const ForkReasonSchema = z.enum([
	"do_claim",
	"wave_item",
	"review_gate",
]);
export type ForkReason = z.infer<typeof ForkReasonSchema>;

export function parseSeedPacket(input: unknown): SeedPacket {
	return SeedPacketSchema.parse(input);
}

export function parsePromotePacket(input: unknown): PromotePacket {
	return PromotePacketSchema.parse(input);
}

export function parseChatForkRecord(input: unknown): ChatForkRecord {
	return ChatForkRecordSchema.parse(input);
}
