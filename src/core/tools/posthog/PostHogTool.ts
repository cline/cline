import axios, { type AxiosError } from 'axios'
import { BaseTool } from '../base/BaseTool'
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
        const response = await axios
            .request<T>({
                url: `${this.config.posthogHost}/api/${endpoint}`,
                method,
                headers: {
                    Authorization: `Bearer ${this.config.posthogApiKey}`,
                    'Content-Type': 'application/json',
                },
                data: data ? JSON.stringify(data) : undefined,
            })
            .catch((error) => {
                if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError
                    const config = this.config

                    console.log(this.config)

                    const errorContext = {
                        endpoint,
                        method,
                        status: axiosError.response?.status,
                        statusText: axiosError.response?.statusText,
                        detail: axiosError.response?.data,
                        message: axiosError.message,
                        code: axiosError.code,
                        requestData: data,
                    }
                    throw new Error(`PostHog API error: ${JSON.stringify(errorContext, null, 2)}`)
                }

                throw new Error(`PostHog API error: ${error}`)
            })

        return response.data
    }
}
