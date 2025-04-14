import type { ToolInput } from '../../base/types'

export interface CreateFeatureFlagInput
    extends ToolInput<{
        name: string
        key: string
        rolloutPercentage?: number
    }> {}

export interface FeatureFlagConfig {
    id: number
    name: string
    key: string
    active: boolean
}
