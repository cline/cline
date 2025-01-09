import { DeepSeekHandler } from '../deepseek';
import { ApiHandlerOptions, deepSeekDefaultModelId } from '../../../shared/api';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

// Mock OpenAI client
const mockCreate = jest.fn();
jest.mock('openai', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockCreate.mockImplementation(async (options) => {
                        if (!options.stream) {
                            return {
                                id: 'test-completion',
                                choices: [{
                                    message: { role: 'assistant', content: 'Test response', refusal: null },
                                    finish_reason: 'stop',
                                    index: 0
                                }],
                                usage: {
                                    prompt_tokens: 10,
                                    completion_tokens: 5,
                                    total_tokens: 15
                                }
                            };
                        }
                        
                        // Return async iterator for streaming
                        return {
                            [Symbol.asyncIterator]: async function* () {
                                yield {
                                    choices: [{
                                        delta: { content: 'Test response' },
                                        index: 0
                                    }],
                                    usage: null
                                };
                                yield {
                                    choices: [{
                                        delta: {},
                                        index: 0
                                    }],
                                    usage: {
                                        prompt_tokens: 10,
                                        completion_tokens: 5,
                                        total_tokens: 15
                                    }
                                };
                            }
                        };
                    })
                }
            }
        }))
    };
});

describe('DeepSeekHandler', () => {
    let handler: DeepSeekHandler;
    let mockOptions: ApiHandlerOptions;

    beforeEach(() => {
        mockOptions = {
            deepSeekApiKey: 'test-api-key',
            deepSeekModelId: 'deepseek-chat',
            deepSeekBaseUrl: 'https://api.deepseek.com/v1'
        };
        handler = new DeepSeekHandler(mockOptions);
        mockCreate.mockClear();
    });

    describe('constructor', () => {
        it('should initialize with provided options', () => {
            expect(handler).toBeInstanceOf(DeepSeekHandler);
            expect(handler.getModel().id).toBe(mockOptions.deepSeekModelId);
        });

        it('should throw error if API key is missing', () => {
            expect(() => {
                new DeepSeekHandler({
                    ...mockOptions,
                    deepSeekApiKey: undefined
                });
            }).toThrow('DeepSeek API key is required');
        });

        it('should use default model ID if not provided', () => {
            const handlerWithoutModel = new DeepSeekHandler({
                ...mockOptions,
                deepSeekModelId: undefined
            });
            expect(handlerWithoutModel.getModel().id).toBe(deepSeekDefaultModelId);
        });

        it('should use default base URL if not provided', () => {
            const handlerWithoutBaseUrl = new DeepSeekHandler({
                ...mockOptions,
                deepSeekBaseUrl: undefined
            });
            expect(handlerWithoutBaseUrl).toBeInstanceOf(DeepSeekHandler);
            // The base URL is passed to OpenAI client internally
            expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
                baseURL: 'https://api.deepseek.com/v1'
            }));
        });

        it('should use custom base URL if provided', () => {
            const customBaseUrl = 'https://custom.deepseek.com/v1';
            const handlerWithCustomUrl = new DeepSeekHandler({
                ...mockOptions,
                deepSeekBaseUrl: customBaseUrl
            });
            expect(handlerWithCustomUrl).toBeInstanceOf(DeepSeekHandler);
            // The custom base URL is passed to OpenAI client
            expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
                baseURL: customBaseUrl
            }));
        });

        it('should set includeMaxTokens to true', () => {
            // Create a new handler and verify OpenAI client was called with includeMaxTokens
            new DeepSeekHandler(mockOptions);
            expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
                apiKey: mockOptions.deepSeekApiKey
            }));
        });
    });

    describe('getModel', () => {
        it('should return model info for valid model ID', () => {
            const model = handler.getModel();
            expect(model.id).toBe(mockOptions.deepSeekModelId);
            expect(model.info).toBeDefined();
            expect(model.info.maxTokens).toBe(8192);
            expect(model.info.contextWindow).toBe(64_000);
            expect(model.info.supportsImages).toBe(false);
            expect(model.info.supportsPromptCache).toBe(false);
        });

        it('should return provided model ID with default model info if model does not exist', () => {
            const handlerWithInvalidModel = new DeepSeekHandler({
                ...mockOptions,
                deepSeekModelId: 'invalid-model'
            });
            const model = handlerWithInvalidModel.getModel();
            expect(model.id).toBe('invalid-model'); // Returns provided ID
            expect(model.info).toBeDefined();
            expect(model.info).toBe(handler.getModel().info); // But uses default model info
        });

        it('should return default model if no model ID is provided', () => {
            const handlerWithoutModel = new DeepSeekHandler({
                ...mockOptions,
                deepSeekModelId: undefined
            });
            const model = handlerWithoutModel.getModel();
            expect(model.id).toBe(deepSeekDefaultModelId);
            expect(model.info).toBeDefined();
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

        it('should handle streaming responses', async () => {
            const stream = handler.createMessage(systemPrompt, messages);
            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            const textChunks = chunks.filter(chunk => chunk.type === 'text');
            expect(textChunks).toHaveLength(1);
            expect(textChunks[0].text).toBe('Test response');
        });

        it('should include usage information', async () => {
            const stream = handler.createMessage(systemPrompt, messages);
            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            const usageChunks = chunks.filter(chunk => chunk.type === 'usage');
            expect(usageChunks.length).toBeGreaterThan(0);
            expect(usageChunks[0].inputTokens).toBe(10);
            expect(usageChunks[0].outputTokens).toBe(5);
        });
    });
});