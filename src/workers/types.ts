import { z } from "zod"

export const countTokensResultSchema = z.discriminatedUnion("success", [
	z.object({
		success: z.literal(true),
		count: z.number(),
	}),
	z.object({ success: z.literal(false), error: z.string() }),
])

export type CountTokensResult = z.infer<typeof countTokensResultSchema>
