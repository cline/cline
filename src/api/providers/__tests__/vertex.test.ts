import { VertexHandler } from '../vertex';
import { Anthropic } from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

// Mock Vertex SDK
jest.mock('@anthropic-ai/vertex-sdk', () => ({
    AnthropicVertex: jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockImplementation(async (options) => {
                if (!options.stream) {
                    return {
                        id: 'test-completion',
                        content: [
                            { type: 'text', text: 'Test response' }
                        ],
                        role: 'assistant',
                        model: options.model,
                        usage: {
                            input_tokens: 10,
                            output_tokens: 5
                        }
                    }
                }
                return {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'message_start',
                            message: {
                                usage: {
                                    input_tokens: 10,
                                    output_tokens: 5
                                }
                            }
                        }
                        yield {
                            type: 'content_block_start',
                            content_block: {
                                type: 'text',
                                text: 'Test response'
                            }
                        }
                    }
                }
            })
        }
    }))
}));

describe('VertexHandler', () => {
    let handler: VertexHandler;

    beforeEach(() => {
        handler = new VertexHandler({
            apiModelId: 'claude-3-5-sonnet-v2@20241022',
            vertexProjectId: 'test-project',
            vertexRegion: 'us-central1'
        });
    });

    describe('constructor', () => {
        it('should initialize with provided config', () => {
            expect(AnthropicVertex).toHaveBeenCalledWith({
                projectId: 'test-project',
                region: 'us-central1'
            });
        });
    });

    describe('createMessage', () => {
        const mockMessages: Anthropic.Messages.MessageParam[] = [
            {
                role: 'user',
                content: 'Hello'
            },
            {
                role: 'assistant',
                content: 'Hi there!'
            }
        ];

        const systemPrompt = 'You are a helpful assistant';

        it('should handle streaming responses correctly', async () => {
            const mockStream = [
                {
                    type: 'message_start',
                    message: {
                        usage: {
                            input_tokens: 10,
                            output_tokens: 0
                        }
                    }
                },
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {
                        type: 'text',
                        text: 'Hello'
                    }
                },
                {
                    type: 'content_block_delta',
                    delta: {
                        type: 'text_delta',
                        text: ' world!'
                    }
                },
                {
                    type: 'message_delta',
                    usage: {
                        output_tokens: 5
                    }
                }
            ];

            // Setup async iterator for mock stream
            const asyncIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockStream) {
                        yield chunk;
                    }
                }
            };

            const mockCreate = jest.fn().mockResolvedValue(asyncIterator);
            (handler['client'].messages as any).create = mockCreate;

            const stream = handler.createMessage(systemPrompt, mockMessages);
            const chunks = [];
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(4);
            expect(chunks[0]).toEqual({
                type: 'usage',
                inputTokens: 10,
                outputTokens: 0
            });
            expect(chunks[1]).toEqual({
                type: 'text',
                text: 'Hello'
            });
            expect(chunks[2]).toEqual({
                type: 'text',
                text: ' world!'
            });
            expect(chunks[3]).toEqual({
                type: 'usage',
                inputTokens: 0,
                outputTokens: 5
            });

            expect(mockCreate).toHaveBeenCalledWith({
                model: 'claude-3-5-sonnet-v2@20241022',
                max_tokens: 8192,
                temperature: 0,
                system: systemPrompt,
                messages: mockMessages,
                stream: true
            });
        });

        it('should handle multiple content blocks with line breaks', async () => {
            const mockStream = [
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {
                        type: 'text',
                        text: 'First line'
                    }
                },
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: {
                        type: 'text',
                        text: 'Second line'
                    }
                }
            ];

            const asyncIterator = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockStream) {
                        yield chunk;
                    }
                }
            };

            const mockCreate = jest.fn().mockResolvedValue(asyncIterator);
            (handler['client'].messages as any).create = mockCreate;

            const stream = handler.createMessage(systemPrompt, mockMessages);
            const chunks = [];
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(3);
            expect(chunks[0]).toEqual({
                type: 'text',
                text: 'First line'
            });
            expect(chunks[1]).toEqual({
                type: 'text',
                text: '\n'
            });
            expect(chunks[2]).toEqual({
                type: 'text',
                text: 'Second line'
            });
        });

        it('should handle API errors', async () => {
            const mockError = new Error('Vertex API error');
            const mockCreate = jest.fn().mockRejectedValue(mockError);
            (handler['client'].messages as any).create = mockCreate;

            const stream = handler.createMessage(systemPrompt, mockMessages);

            await expect(async () => {
                for await (const chunk of stream) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow('Vertex API error');
        });
    });

    describe('completePrompt', () => {
        it('should complete prompt successfully', async () => {
            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(handler['client'].messages.create).toHaveBeenCalledWith({
                model: 'claude-3-5-sonnet-v2@20241022',
                max_tokens: 8192,
                temperature: 0,
                messages: [{ role: 'user', content: 'Test prompt' }],
                stream: false
            });
        });

        it('should handle API errors', async () => {
            const mockError = new Error('Vertex API error');
            const mockCreate = jest.fn().mockRejectedValue(mockError);
            (handler['client'].messages as any).create = mockCreate;

            await expect(handler.completePrompt('Test prompt'))
                .rejects.toThrow('Vertex completion error: Vertex API error');
        });

        it('should handle non-text content', async () => {
            const mockCreate = jest.fn().mockResolvedValue({
                content: [{ type: 'image' }]
            });
            (handler['client'].messages as any).create = mockCreate;

            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('');
        });

        it('should handle empty response', async () => {
            const mockCreate = jest.fn().mockResolvedValue({
                content: [{ type: 'text', text: '' }]
            });
            (handler['client'].messages as any).create = mockCreate;

            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('');
        });
    });

    describe('getModel', () => {
        it('should return correct model info', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe('claude-3-5-sonnet-v2@20241022');
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(8192);
            expect(modelInfo.info.contextWindow).toBe(200_000);
        });

        it('should return default model if invalid model specified', () => {
            const invalidHandler = new VertexHandler({
                apiModelId: 'invalid-model',
                vertexProjectId: 'test-project',
                vertexRegion: 'us-central1'
            });
            const modelInfo = invalidHandler.getModel();
            expect(modelInfo.id).toBe('claude-3-5-sonnet-v2@20241022'); // Default model
        });
    });
});