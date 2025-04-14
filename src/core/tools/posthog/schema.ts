import { z } from 'zod'

export const BasePostHogToolConfigSchema = z.object({
    posthogApiKey: z.string(),
    posthogHost: z.string(),
    posthogProjectId: z.string(),
})
