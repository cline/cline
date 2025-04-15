import { PostHogTool } from '../PostHogTool'
import { z } from 'zod'
import type { ToolOutput } from '../../base/types'
import type { ToolUse } from '../../../assistant-message'
import { BasePostHogToolConfigSchema } from '../schema'

// Define the input/output schemas
export const ListFeatureFlagsToolInputSchema = z.object({
    query: z
        .object({
            active: z.enum(['true', 'false']).optional().describe('Filter feature flags by their active status'),
            created_by_id: z
                .string()
                .optional()
                .describe('Filter by the User ID which initially created the feature flag'),
            limit: z.number().int().positive().optional().describe('Number of results to return per page'),
            offset: z.number().int().min(0).optional().describe('The initial index from which to return the results'),
            search: z.string().optional().describe('Search by feature flag key or name (case insensitive)'),
            type: z.enum(['boolean', 'experiment', 'multivariant']).optional().describe('Filter by feature flag type'),
        })
        .optional()
        .describe('Query parameters for the list feature flags request'),
})

export const ListFeatureFlagsToolOutputSchema = z.object({
    results: z.array(z.object({})),
    next: z.string().optional().describe('URL to the next page of results'),
    previous: z.string().optional().describe('URL to the previous page of results'),
    count: z.number().describe('Total number of feature flags'),
})

export type ListFeatureFlagsToolInput = z.infer<typeof ListFeatureFlagsToolInputSchema>
export type ListFeatureFlagsToolOutput = z.infer<typeof ListFeatureFlagsToolOutputSchema>

export class ListFeatureFlagsTool extends PostHogTool<ListFeatureFlagsToolInput, ListFeatureFlagsToolOutput> {
    autoApprove = true
    name = 'list_feature_flags'
    description =
        'List all feature flags in the project. Supports filtering by active status, creator, type, and search terms.'
    inputSchema = ListFeatureFlagsToolInputSchema
    outputSchema = ListFeatureFlagsToolOutputSchema

    static isValidConfig(config: unknown): boolean {
        const result = BasePostHogToolConfigSchema.safeParse(config)
        return result.success
    }

    async execute(input: ListFeatureFlagsToolInput): Promise<ToolOutput<ListFeatureFlagsToolOutput>> {
        try {
            const queryParams = new URLSearchParams()
            for (const [key, value] of Object.entries(input)) {
                if (value !== undefined) {
                    queryParams.append(key, value.toString())
                }
            }

            const queryString = queryParams.toString()
            const endpoint = `projects/${this.config.posthogProjectId}/feature_flags/${queryString ? '?' + queryString : ''}`

            const data = await this.makeRequest<unknown>(endpoint, 'GET')

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

    static getToolDefinitionForPrompt(): string {
        return `Description: List all feature flags in PostHog.
Parameters:
- query: (optional) query parameters for the list feature flags request
Usage:
<list_feature_flags>
<query>
{
  "active": true or false
}
</query>
</list_feature_flags>`
    }

    getToolUsageDescription(block: ToolUse): string {
        const params = block.params as ListFeatureFlagsToolInput
        const filters = Object.entries(params)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')
        return `[list feature flags${filters ? ` with filters: ${filters}` : ''}]`
    }
}
