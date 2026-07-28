import { z } from "zod";

export const ShareModeSchema = z.enum(["structured", "demo", "pixel"]);
export type ShareMode = z.infer<typeof ShareModeSchema>;

export const StructuredSharePayloadSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("selection"),
			path: z.string().min(1),
			startLine: z.number().int().nonnegative(),
			endLine: z.number().int().nonnegative(),
			textHash: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("file"),
			path: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("terminal"),
			sessionId: z.string().min(1),
			excerptHash: z.string().min(1),
		})
		.strict(),
]);
export type StructuredSharePayload = z.infer<
	typeof StructuredSharePayloadSchema
>;

export const DemoArtifactRefSchema = z
	.object({
		artifactId: z.string().min(1),
		mediaKind: z.enum(["screenshot", "video_clip", "animation", "diagram"]),
		uri: z.string().min(1),
		caption: z.string(),
		sourceUrl: z.string().min(1).optional(),
		width: z.number().int().positive().optional(),
		height: z.number().int().positive().optional(),
		durationMs: z.number().int().nonnegative().optional(),
		createdAt: z.string().datetime(),
	})
	.strict();
export type DemoArtifactRef = z.infer<typeof DemoArtifactRefSchema>;

export const DemoStageSharerSchema = z
	.object({
		participantId: z.string().min(1),
		kind: z.enum(["human", "agent"]),
		shareMode: ShareModeSchema,
	})
	.strict();
export type DemoStageSharer = z.infer<typeof DemoStageSharerSchema>;

