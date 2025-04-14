import type { CreateFeatureFlag } from './feature-flags/create'

export interface PostHogToolConfig {
    posthogApiKey: string
    posthogHost: string
    posthogProjectId: string
}

export type Tool = CreateFeatureFlag
