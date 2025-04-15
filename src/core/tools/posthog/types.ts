import type { CreateFeatureFlagTool } from './feature-flags/CreateFeatureFlagTool'
import type { UpdateFeatureFlagTool } from './feature-flags/UpdateFeatureFlagTool'
import type { ListFeatureFlagsTool } from './feature-flags/ListFeatureFlagsTool'

export interface PostHogToolConfig {
    posthogApiKey: string
    posthogHost: string
    posthogProjectId: string
}

export type Tool = CreateFeatureFlagTool | UpdateFeatureFlagTool | ListFeatureFlagsTool
