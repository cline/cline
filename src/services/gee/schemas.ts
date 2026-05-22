import { z } from "zod"

export const geeCommandSchema = z.object({
	command: z.enum(["chooseProject", "connect", "status", "previewChirpsLayer"]),
	requestId: z.string().min(1),
	payload: z.record(z.string(), z.unknown()).optional(),
})

export const geeStatusPayloadSchema = z
	.object({
		projectId: z.string().min(3).optional(),
	})
	.optional()

export const geePreviewChirpsPayloadSchema = z.object({
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	projectId: z.string().min(3).optional(),
	roiGeoJson: z.string().optional(),
})

export type GeeCommandEnvelope = z.infer<typeof geeCommandSchema>
export type GeePreviewChirpsPayload = z.infer<typeof geePreviewChirpsPayloadSchema>
