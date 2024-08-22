import { z } from "zod"

export const MaestroUserSchema = z.object({
	id: z.string(),
	image: z.string().nullable(),
	email: z.string().email(),
	name: z.string().nullable(),
	emailVerified: z.coerce.date().nullable(),
})
export type MaestroUser = z.infer<typeof MaestroUserSchema>
