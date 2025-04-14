import { z } from 'zod'
import { BasePostHogToolConfigSchema } from '../schema'

export const CreateFeatureFlagToolInputSchema = z.object({
    name: z.string(),
    key: z.string(),
})

export type CreateFeatureFlagToolInput = z.infer<typeof CreateFeatureFlagToolInputSchema>

export const CreateFeatureFlagToolOutputSchema = z.object({
    id: z.number(),
    name: z.string(),
    key: z.string(),
    active: z.boolean(),
})

export type CreateFeatureFlagToolOutput = z.infer<typeof CreateFeatureFlagToolOutputSchema>

export const CreateFeatureFlagToolConfigSchema = BasePostHogToolConfigSchema

export type CreateFeatureFlagToolConfig = z.infer<typeof CreateFeatureFlagToolConfigSchema>
