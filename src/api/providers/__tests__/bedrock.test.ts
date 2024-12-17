import { AwsBedrockHandler } from '../bedrock'
import { ApiHandlerOptions, ModelInfo } from '../../../shared/api'
import { Anthropic } from '@anthropic-ai/sdk'
import { StreamEvent } from '../bedrock'

// Simplified mock for BedrockRuntimeClient
class MockBedrockRuntimeClient {
    private _region: string
    private mockStream: StreamEvent[] = []

    constructor(config: { region: string }) {
        this._region = config.region
    }

    async send(command: any): Promise<{ stream: AsyncIterableIterator<StreamEvent> }> {
        return {
            stream: this.createMockStream()
        }
    }

    private createMockStream(): AsyncIterableIterator<StreamEvent> {
        const self = this;
        return {
            async *[Symbol.asyncIterator]() {
                for (const event of self.mockStream) {
                    yield event;
                }
            },
            next: async () => {
                const value = this.mockStream.shift();
                return value ? { value, done: false } : { value: undefined, done: true };
            },
            return: async () => ({ value: undefined, done: true }),
            throw: async (e) => { throw e; }
        };
    }

    setMockStream(stream: StreamEvent[]) {
        this.mockStream = stream;
    }

    get config() {
        return { region: this._region };
    }
}

describe('AwsBedrockHandler', () => {
    const mockOptions: ApiHandlerOptions = {
        awsRegion: 'us-east-1',
        awsAccessKey: 'mock-access-key',
        awsSecretKey: 'mock-secret-key',
        apiModelId: 'anthropic.claude-v2',
    }

    // Override the BedrockRuntimeClient creation in the constructor
    class TestAwsBedrockHandler extends AwsBedrockHandler {
        constructor(options: ApiHandlerOptions, mockClient?: MockBedrockRuntimeClient) {
            super(options)
            if (mockClient) {
                // Force type casting to bypass strict type checking
                (this as any)['client'] = mockClient
            }
        }
    }

    test('constructor initializes with correct AWS credentials', () => {
        const mockClient = new MockBedrockRuntimeClient({
            region: 'us-east-1'
        })

        const handler = new TestAwsBedrockHandler(mockOptions, mockClient)
        
        // Verify that the client is created with the correct configuration
        expect(handler['client']).toBeDefined()
        expect(handler['client'].config.region).toBe('us-east-1')
    })

    test('getModel returns correct model info', () => {
        const mockClient = new MockBedrockRuntimeClient({
            region: 'us-east-1'
        })

        const handler = new TestAwsBedrockHandler(mockOptions, mockClient)
        const result = handler.getModel()
        
        expect(result).toEqual({
            id: 'anthropic.claude-v2',
            info: {
                maxTokens: 5000,
                contextWindow: 128_000,
                supportsPromptCache: false
            }
        })
    })

    test('createMessage handles successful stream events', async () => {
        const mockClient = new MockBedrockRuntimeClient({
            region: 'us-east-1'
        })
        
        // Mock stream events
        const mockStreamEvents: StreamEvent[] = [
            {
                metadata: {
                    usage: {
                        inputTokens: 50,
                        outputTokens: 100
                    }
                }
            },
            {
                contentBlockStart: {
                    start: {
                        text: 'Hello'
                    }
                }
            },
            {
                contentBlockDelta: {
                    delta: {
                        text: ' world'
                    }
                }
            },
            {
                messageStop: {
                    stopReason: 'end_turn'
                }
            }
        ]

        mockClient.setMockStream(mockStreamEvents)

        const handler = new TestAwsBedrockHandler(mockOptions, mockClient)

        const systemPrompt = 'You are a helpful assistant'
        const messages: Anthropic.Messages.MessageParam[] = [
            { role: 'user', content: 'Say hello' }
        ]

        const generator = handler.createMessage(systemPrompt, messages)
        const chunks = []

        for await (const chunk of generator) {
            chunks.push(chunk)
        }

        // Verify the chunks match expected stream events
        expect(chunks).toHaveLength(3)
        expect(chunks[0]).toEqual({
            type: 'usage',
            inputTokens: 50,
            outputTokens: 100
        })
        expect(chunks[1]).toEqual({
            type: 'text',
            text: 'Hello'
        })
        expect(chunks[2]).toEqual({
            type: 'text',
            text: ' world'
        })
    })

    test('createMessage handles error scenarios', async () => {
        const mockClient = new MockBedrockRuntimeClient({
            region: 'us-east-1'
        })

        // Simulate an error by overriding the send method
        mockClient.send = () => {
            throw new Error('API request failed')
        }

        const handler = new TestAwsBedrockHandler(mockOptions, mockClient)

        const systemPrompt = 'You are a helpful assistant'
        const messages: Anthropic.Messages.MessageParam[] = [
            { role: 'user', content: 'Cause an error' }
        ]

        await expect(async () => {
            const generator = handler.createMessage(systemPrompt, messages)
            const chunks = []
            
            for await (const chunk of generator) {
                chunks.push(chunk)
            }
        }).rejects.toThrow('API request failed')
    })
})
