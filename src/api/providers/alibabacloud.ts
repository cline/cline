import OpenAI from "openai";
import {
    ApiHandlerOptions,
    AlibabaCloudModelId,
    alibabaCloudModels,
    alibabaCloudDefaultModelId,
    
} from "../../shared/api";
import { ApiHandler } from "../index";
import { ApiStream, ApiStreamChunk } from "../transform/stream";

export class AlibabaCloudHandler implements ApiHandler {
    private options: ApiHandlerOptions;
    private client: OpenAI;

    constructor(options: ApiHandlerOptions) {
        // Validate configuration
        if (!options.alibabaCloudApiKey?.trim()) {
            throw new Error('Invalid Alibaba Cloud API configuration');
        }

        this.options = options;
        
        // Use OpenAI-compatible API for Alibaba Cloud
        this.client = new OpenAI({
            apiKey: this.options.alibabaCloudApiKey || '',
            baseURL: this.options.alibabaCloudBaseUrl || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        });
    }

    getModel() {
        const modelId = (this.options.alibabaCloudModelId || alibabaCloudDefaultModelId) as AlibabaCloudModelId;
        return {
            id: modelId,
            info: alibabaCloudModels[modelId]
        };
    }

    async *createMessage(systemPrompt: string, messages: any[]): ApiStream {
        const modelId = this.getModel().id;
        
        try {
            const stream = await this.client.chat.completions.create({
                model: modelId,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages
                ],
                stream: true,
                max_tokens: this.getModel().info.maxTokens
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    yield { type: "text", text: content } as ApiStreamChunk;
                }
            }
        } catch (error) {
            console.error('Alibaba Cloud API Error:', error);
            throw error;
        }
    }
}
