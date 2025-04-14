import { z } from 'zod'
import { PostHogTool } from '../PostHogTool'
import {
    CreateFeatureFlagToolInputSchema,
    CreateFeatureFlagToolOutputSchema,
    type CreateFeatureFlagToolInput,
    type CreateFeatureFlagToolOutput,
} from './schema'
import type { ToolOutput } from '../../base/types'
import type { ToolUse } from '../../../assistant-message'
import { CreateFeatureFlagToolConfigSchema } from './schema'

export class CreateFeatureFlagTool extends PostHogTool<CreateFeatureFlagToolInput, CreateFeatureFlagToolOutput> {
    autoApprove = false
    name = 'create_feature_flag'
    description = 'Create a new feature flag'
    inputSchema = CreateFeatureFlagToolInputSchema
    outputSchema = CreateFeatureFlagToolOutputSchema

    static isValidConfig(config: unknown): boolean {
        const result = CreateFeatureFlagToolConfigSchema.safeParse(config)

        return result.success
    }

    async execute(input: CreateFeatureFlagToolInput): Promise<ToolOutput<CreateFeatureFlagToolOutput>> {
        try {
            const currentUser = await this.makeRequest<{ email?: string }>('users/@me', 'GET')

            const data = await this.makeRequest<unknown>(
                `projects/1/feature_flags/`, // TODO: use the project id from the config
                'POST',
                {
                    key: input.key,
                    name: input.name,
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
        return `[Create a new feature flag with the name ${block.name}]`
    }

    getApprovalRequest(input: CreateFeatureFlagToolInput): string {
        return `Max wants to create a feature flag with the name ${input.name}`
    }
}
