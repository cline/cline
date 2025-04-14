import type { BaseTool } from './base/BaseTool'
import { CreateFeatureFlagTool } from './posthog/feature-flags/CreateFeatureFlagTool'
import { UpdateFeatureFlagTool } from './posthog/feature-flags/UpdateFeatureFlagTool'
import type { PostHogToolConfig, Tool } from './posthog/types'

type ToolManagerConfig = Partial<PostHogToolConfig>

type ToolMapping = {
    create_feature_flag: CreateFeatureFlagTool
    update_feature_flag: UpdateFeatureFlagTool
}

type ToolName = keyof ToolMapping

type ToolMap = ReadonlyMap<ToolName, BaseTool<any, any> | undefined>

export class ToolManager {
    public tools: ToolMap
    private config: ToolManagerConfig

    constructor(config: ToolManagerConfig) {
        this.config = config

        //@ts-ignore
        this.tools = new Map([
            [
                'create_feature_flag',
                CreateFeatureFlagTool.isValidConfig(this.config)
                    ? new CreateFeatureFlagTool(this.config as PostHogToolConfig)
                    : undefined,
            ],
            [
                'update_feature_flag',
                UpdateFeatureFlagTool.isValidConfig(this.config)
                    ? new UpdateFeatureFlagTool(this.config as PostHogToolConfig)
                    : undefined,
            ],
        ] as const)
    }

    getTool(name: ToolName): ToolMapping[ToolName] | undefined {
        return this.tools.get(name) as ToolMapping[ToolName] | undefined
    }
}
