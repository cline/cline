import { z } from "zod"

export const checkpointSchema = z.object({
	from: z.string(),
	to: z.string(),
})

export type Checkpoint = z.infer<typeof checkpointSchema>
