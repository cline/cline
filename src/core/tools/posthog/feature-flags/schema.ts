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

export const UpdateFeatureFlagToolInputSchema = z.object({
  id: z.number(),
  active: z.boolean().optional(),
})

export type UpdateFeatureFlagToolInput = z.infer<typeof UpdateFeatureFlagToolInputSchema>

export const UpdateFeatureFlagToolOutputSchema = z.object({
  id: z.number(),
  active: z.boolean()
})

export type UpdateFeatureFlagToolOutput = z.infer<typeof UpdateFeatureFlagToolOutputSchema>
