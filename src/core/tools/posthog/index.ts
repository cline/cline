import { BaseTool } from '../base'
import type { PostHogToolConfig } from './types'

export abstract class PostHogTool<TInput, TOutput> extends BaseTool<TInput, TOutput> {
    config: PostHogToolConfig

    constructor(config: PostHogToolConfig) {
        super()
        this.config = config
    }

    protected async makeRequest<T>(
        endpoint: string,
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        data?: unknown
    ): Promise<T> {
        const response = await fetch(`${this.config.posthogHost}/api/${endpoint}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.config.posthogApiKey}`,
                'Content-Type': 'application/json',
            },
            body: data ? JSON.stringify(data) : undefined,
        })

        if (!response.ok) {
            throw new Error(`PostHog API error: ${response.statusText}`)
        }

        return response.json()
    }
}
