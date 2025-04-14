import type { CreateFeatureFlagTool } from './feature-flags/CreateFeatureFlagTool'

export interface PostHogToolConfig {
    posthogApiKey: string
    posthogHost: string
    posthogProjectId: string
}

export type Tool = CreateFeatureFlagTool
