import { z } from "zod";

export const ShowArtifactKindSchema = z.enum([
	"diagram.architecture",
	"diagram.data_flow",
	"diagram.network_security",
	"diagram.sequence",
	"walkthrough.code",
	"walkthrough.animation",
	"doc.plan",
	"doc.review",
	"capture.screenshot",
	"capture.demo_clip",
	"share.structured",
	"work.card",
]);
export type ShowArtifactKind = z.infer<typeof ShowArtifactKindSchema>;

export const MediaClassSchema = z.enum([
	"still",
	"animation",
	"video",
	"document",
	"structured",
	"work",
]);
export type MediaClass = z.infer<typeof MediaClassSchema>;

export const StickyPolicySchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("replace") }).strict(),
	z.object({ mode: z.literal("hold") }).strict(),
	z
		.object({
			mode: z.literal("hold_until"),
			beatId: z.string().min(1),
		})
		.strict(),
]);
export type StickyPolicy = z.infer<typeof StickyPolicySchema>;

export const ShowBacklogItemSchema = z
	.object({
		id: z.string().min(1),
		ownerParticipantId: z.string().min(1),
		title: z.string().min(1),
		intent: z.string(),
		artifactKind: ShowArtifactKindSchema,
		mediaClass: MediaClassSchema,
		uri: z.string().min(1).optional(),
		caption: z.string(),
		produce: z
			.object({
				tool: z.string().min(1),
				templateId: z.string().min(1).optional(),
				args: z.record(z.string(), z.unknown()),
			})
			.strict(),
		priority: z.number(),
		status: z.enum([
			"planned",
			"ready",
			"showing",
			"shown",
			"cancelled",
		]),
		linkedDoItemId: z.string().min(1).optional(),
		linkedScriptId: z.string().min(1).optional(),
		scoreReasons: z.array(z.string()),
	})
	.strict();
export type ShowBacklogItem = z.infer<typeof ShowBacklogItemSchema>;

export const DoBacklogItemSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		goal: z.string(),
		assigneeParticipantId: z.string().min(1).optional(),
		priority: z.number(),
		status: z.enum(["queued", "active", "blocked", "done"]),
		dependsOn: z.array(z.string()),
		source: z.enum(["human", "planner", "router", "system"]),
	})
	.strict();
export type DoBacklogItem = z.infer<typeof DoBacklogItemSchema>;

export const ScriptBeatSchema = z
	.object({
		beatId: z.string().min(1),
		say: z.string(),
		showItemId: z.string().min(1),
		sticky: StickyPolicySchema,
		advance: z.enum([
			"auto_after_say",
			"on_tool",
			"on_human",
			"with_do_item",
		]),
	})
	.strict();
export type ScriptBeat = z.infer<typeof ScriptBeatSchema>;

export const DirectorScriptSchema = z
	.object({
		scriptId: z.string().min(1),
		ownerParticipantId: z.string().min(1),
		title: z.string().min(1),
		beats: z.array(ScriptBeatSchema).min(1),
		stickyShowIds: z.array(z.string()),
	})
	.strict();
export type DirectorScript = z.infer<typeof DirectorScriptSchema>;

export const AgentMediaBagSchema = z
	.object({
		participantId: z.string().min(1),
		showBacklog: z.array(ShowBacklogItemSchema),
		scripts: z.array(DirectorScriptSchema),
		voiceSlotId: z.string().min(1).optional(),
	})
	.strict();
export type AgentMediaBag = z.infer<typeof AgentMediaBagSchema>;

export const ParticipantAudioFlagsSchema = z
	.object({
		participantId: z.string().min(1),
		muted: z.boolean(),
		deafened: z.boolean(),
	})
	.strict();
export type ParticipantAudioFlags = z.infer<typeof ParticipantAudioFlagsSchema>;

export const StageDirectorStateSchema = z
	.object({
		doBacklog: z.array(DoBacklogItemSchema),
		showBacklog: z.array(ShowBacklogItemSchema),
		activeScript: DirectorScriptSchema.nullable(),
		activeBeatId: z.string().min(1).nullable(),
		activeShowId: z.string().min(1).nullable(),
		stickyShowIds: z.array(z.string()),
		spotlightParticipantId: z.string().min(1).nullable(),
		lastPresentedAt: z.string().datetime().nullable(),
	})
	.strict();
export type StageDirectorState = z.infer<typeof StageDirectorStateSchema>;

export const ConversationChannelSchema = z.enum(["room", "a2a"]);
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;

export function parseStageDirectorState(input: unknown): StageDirectorState {
	return StageDirectorStateSchema.parse(input);
}

export function parseAgentMediaBag(input: unknown): AgentMediaBag {
	return AgentMediaBagSchema.parse(input);
}

export function defaultStickyForArtifactKind(
	kind: ShowArtifactKind,
): StickyPolicy {
	switch (kind) {
		case "diagram.architecture":
		case "diagram.data_flow":
		case "diagram.network_security":
		case "diagram.sequence":
		case "walkthrough.code":
		case "walkthrough.animation":
		case "doc.plan":
		case "doc.review":
			return { mode: "hold" };
		case "capture.screenshot":
		case "capture.demo_clip":
		case "share.structured":
		case "work.card":
			return { mode: "replace" };
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}
