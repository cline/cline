import { CreateFeatureFlagTool } from './posthog/feature-flags/CreateFeatureFlagTool'
import type { PostHogToolConfig, Tool } from './posthog/types'

type ToolManagerConfig = Partial<PostHogToolConfig>

type ToolName = 'create_feature_flag'
type ToolMap = ReadonlyMap<ToolName, Tool | undefined>

export class ToolManager {
    public tools: ToolMap
    private config: ToolManagerConfig

    constructor(config: ToolManagerConfig) {
        this.config = config
        this.tools = new Map([
            [
                'create_feature_flag',
                CreateFeatureFlagTool.isValidConfig(this.config)
                    ? new CreateFeatureFlagTool(this.config as PostHogToolConfig)
                    : undefined,
            ],
        ] as const)
    }

    getTool<T extends Tool>(name: ToolName): T | undefined {
        return this.tools.get(name) as T | undefined
    }
}
