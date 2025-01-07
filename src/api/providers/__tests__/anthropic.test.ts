import { AnthropicHandler } from '../anthropic';
import { ApiHandlerOptions } from '../../../shared/api';
import { ApiStream } from '../../transform/stream';
import { Anthropic } from '@anthropic-ai/sdk';

// Mock Anthropic client
const mockBetaCreate = jest.fn();
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
    return {
        Anthropic: jest.fn().mockImplementation(() => ({
            beta: {
                promptCaching: {
                    messages: {
                        create: mockBetaCreate.mockImplementation(async () => ({
                            async *[Symbol.asyncIterator]() {
                                yield {
                                    type: 'message_start',
                                    message: {
                                        usage: {
                                            input_tokens: 100,
                                            output_tokens: 50,
                                            cache_creation_input_tokens: 20,
                                            cache_read_input_tokens: 10
                                        }
                                    }
                                };
                                yield {
                                    type: 'content_block_start',
                                    index: 0,
                                    content_block: {
                                        type: 'text',
                                        text: 'Hello'
                                    }
                                };
                                yield {
                                    type: 'content_block_delta',
                                    delta: {
                                        type: 'text_delta',
                                        text: ' world'
                                    }
                                };
                            }
                        }))
                    }
                }
            },
            messages: {
                create: mockCreate
            }
        }))
    };
});

describe('AnthropicHandler', () => {
    let handler: AnthropicHandler;
    let mockOptions: ApiHandlerOptions;

    beforeEach(() => {
        mockOptions = {
            apiKey: 'test-api-key',
            apiModelId: 'claude-3-5-sonnet-20241022'
        };
        handler = new AnthropicHandler(mockOptions);
        mockBetaCreate.mockClear();
        mockCreate.mockClear();
    });

    describe('constructor', () => {
        it('should initialize with provided options', () => {
            expect(handler).toBeInstanceOf(AnthropicHandler);
            expect(handler.getModel().id).toBe(mockOptions.apiModelId);
        });

        it('should initialize with undefined API key', () => {
            // The SDK will handle API key validation, so we just verify it initializes
            const handlerWithoutKey = new AnthropicHandler({
                ...mockOptions,
                apiKey: undefined
            });
            expect(handlerWithoutKey).toBeInstanceOf(AnthropicHandler);
        });

        it('should use custom base URL if provided', () => {
            const customBaseUrl = 'https://custom.anthropic.com';
            const handlerWithCustomUrl = new AnthropicHandler({
                ...mockOptions,
                anthropicBaseUrl: customBaseUrl
            });
            expect(handlerWithCustomUrl).toBeInstanceOf(AnthropicHandler);
        });
    });

    describe('createMessage', () => {
        const systemPrompt = 'You are a helpful assistant.';
        const messages: Anthropic.Messages.MessageParam[] = [
            {
                role: 'user',
                content: [{ 
                    type: 'text' as const,
                    text: 'Hello!'
                }]
            }
        ];

        it('should handle prompt caching for supported models', async () => {
            const stream = handler.createMessage(systemPrompt, [
                {
                    role: 'user',
                    content: [{ type: 'text' as const, text: 'First message' }]
                },
                {
                    role: 'assistant',
                    content: [{ type: 'text' as const, text: 'Response' }]
                },
                {
                    role: 'user',
                    content: [{ type: 'text' as const, text: 'Second message' }]
                }
            ]);

            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            // Verify usage information
            const usageChunk = chunks.find(chunk => chunk.type === 'usage');
            expect(usageChunk).toBeDefined();
            expect(usageChunk?.inputTokens).toBe(100);
            expect(usageChunk?.outputTokens).toBe(50);
            expect(usageChunk?.cacheWriteTokens).toBe(20);
            expect(usageChunk?.cacheReadTokens).toBe(10);

            // Verify text content
            const textChunks = chunks.filter(chunk => chunk.type === 'text');
            expect(textChunks).toHaveLength(2);
            expect(textChunks[0].text).toBe('Hello');
            expect(textChunks[1].text).toBe(' world');

            // Verify beta API was used
            expect(mockBetaCreate).toHaveBeenCalled();
            expect(mockCreate).not.toHaveBeenCalled();
        });
    });

    describe('getModel', () => {
        it('should return default model if no model ID is provided', () => {
            const handlerWithoutModel = new AnthropicHandler({
                ...mockOptions,
                apiModelId: undefined
            });
            const model = handlerWithoutModel.getModel();
            expect(model.id).toBeDefined();
            expect(model.info).toBeDefined();
        });

        it('should return specified model if valid model ID is provided', () => {
            const model = handler.getModel();
            expect(model.id).toBe(mockOptions.apiModelId);
            expect(model.info).toBeDefined();
            expect(model.info.maxTokens).toBe(8192);
            expect(model.info.contextWindow).toBe(200_000);
            expect(model.info.supportsImages).toBe(true);
            expect(model.info.supportsPromptCache).toBe(true);
        });
    });
});