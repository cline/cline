import { z } from 'zod'
import { PostHogTool } from '..'
import type { CreateFeatureFlagInput, FeatureFlagConfig } from './types'
import type { ToolOutput } from '../../base/types'
import type { ToolUse } from '../../../assistant-message'

export class CreateFeatureFlag extends PostHogTool<CreateFeatureFlagInput, FeatureFlagConfig> {
    autoApprove = false
    name = 'create_feature_flag'
    description = 'Create a new feature flag'
    inputSchema = z.object({
        name: z.string(),
        key: z.string(),
        rolloutPercentage: z.number().optional(),
    })

    outputSchema = z.object({
        id: z.number(),
        name: z.string(),
        key: z.string(),
        active: z.boolean(),
    })

    static readonly overrideconfigSchema = z.object({
        posthogApiKey: z.string(),
        posthogHost: z.string(),
        posthogProjectId: z.string(),
    })

    async execute(input: CreateFeatureFlagInput): Promise<ToolOutput<FeatureFlagConfig>> {
        try {
            const data = await this.makeRequest<unknown>(
                `projects/${this.config.posthogProjectId}/feature_flags/`,
                'POST',
                {
                    name: input.name,
                    key: input.key,
                    filters: {
                        groups: [
                            {
                                properties: [],
                                rollout_percentage: input.rolloutPercentage ?? 100,
                            },
                        ],
                    },
                    active: true,
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
        return `[Create a new feature flag with the name ${block.name}]`
    }
}
