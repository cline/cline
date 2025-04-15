import { PostHogTool } from '../PostHogTool'
import {
    UpdateFeatureFlagToolInputSchema,
    UpdateFeatureFlagToolOutputSchema,
    type UpdateFeatureFlagToolInput,
    type UpdateFeatureFlagToolOutput,
} from './schema'
import type { ToolOutput } from '../../base/types'
import type { ToolUse } from '../../../assistant-message'
import { BasePostHogToolConfigSchema } from '../schema'

export class UpdateFeatureFlagTool extends PostHogTool<UpdateFeatureFlagToolInput, UpdateFeatureFlagToolOutput> {
    autoApprove = false
    name = 'update_feature_flag'
    description = 'Update an existing feature flag'
    inputSchema = UpdateFeatureFlagToolInputSchema
    outputSchema = UpdateFeatureFlagToolOutputSchema

    static isValidConfig(config: unknown): boolean {
        const result = BasePostHogToolConfigSchema.safeParse(config)
        return result.success
    }

    async execute(input: UpdateFeatureFlagToolInput): Promise<ToolOutput<UpdateFeatureFlagToolOutput>> {
        try {
            // Prepare the update payload
            const updatePayload: Record<string, unknown> = {}

            if (input.body.active !== undefined) {
                updatePayload.active = input.body.active
            }

            const data = await this.makeRequest<unknown>(
                `projects/${this.config.posthogProjectId}/feature_flags/${input.id}/`,
                'PATCH',
                updatePayload
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
        return `[update feature flag with id ${block.params.id}]`
    }
}
