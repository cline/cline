import { z } from 'zod'
import { PostHogTool } from '../PostHogTool'
import type { ToolOutput } from '../../base/types'
import type { ToolUse } from '../../../assistant-message'
import { BasePostHogToolConfigSchema } from '../schema'

export const CreateFeatureFlagToolInputSchema = z.object({
    body: z.object({
        key: z.string(),
        name: z.string(),
    }),
})

export type CreateFeatureFlagToolInput = z.infer<typeof CreateFeatureFlagToolInputSchema>

export const CreateFeatureFlagToolOutputSchema = z.object({
    id: z.number(),
    name: z.string(),
    key: z.string(),
    active: z.boolean(),
})

export type CreateFeatureFlagToolOutput = z.infer<typeof CreateFeatureFlagToolOutputSchema>
export class CreateFeatureFlagTool extends PostHogTool<CreateFeatureFlagToolInput, CreateFeatureFlagToolOutput> {
    autoApprove = false
    name = 'create_feature_flag'
    description = 'Create a new feature flag'
    inputSchema = CreateFeatureFlagToolInputSchema
    outputSchema = CreateFeatureFlagToolOutputSchema

    static isValidConfig(config: unknown): boolean {
        const result = BasePostHogToolConfigSchema.safeParse(config)

        return result.success
    }

    async execute(input: CreateFeatureFlagToolInput): Promise<ToolOutput<CreateFeatureFlagToolOutput>> {
        try {
            const currentUser = await this.makeRequest<{ email?: string }>('users/@me', 'GET')

            const data = await this.makeRequest<unknown>(
                `projects/${this.config.posthogProjectId}/feature_flags/`,
                'POST',
                {
                    key: input.body.key,
                    name: input.body.name,
                    filters: {
                        groups: [
                            {
                                properties: [
                                    {
                                        key: 'email',
                                        value: [currentUser.email],
                                        operator: 'exact',
                                        type: 'person',
                                    },
                                ],
                                rollout_percentage: 100,
                                variant: null,
                            },
                        ],
                        multivariate: null,
                        payloads: {},
                    },
                    deleted: false,
                    active: true,
                    is_simple_flag: false,
                    rollout_percentage: null,
                    ensure_experience_continuity: false,
                    experiment_set: null,
                    features: [],
                    rollback_conditions: [],
                    surveys: null,
                    performed_rollback: false,
                    tags: [],
                    is_remote_configuration: false,
                    has_encrypted_payloads: false,
                }
            )

            return {
                success: true,
                data: this.validateOutput(data),
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    getToolUsageDescription(block: ToolUse): string {
        try {
            return `[create feature flag with key ${block.params.body ? JSON.parse(block.params.body)?.key : ''}]`
        } catch (error) {
            return `[create feature flag]`
        }
    }
}
