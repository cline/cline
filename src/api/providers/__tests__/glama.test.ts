import { GlamaHandler } from '../glama';
import { ApiHandlerOptions } from '../../../shared/api';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import axios from 'axios';

// Mock OpenAI client
const mockCreate = jest.fn();
const mockWithResponse = jest.fn();

jest.mock('openai', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: (...args: any[]) => {
                        const stream = {
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

                        const result = mockCreate(...args);
                        if (args[0].stream) {
                            mockWithResponse.mockReturnValue(Promise.resolve({
                                data: stream,
                                response: {
                                    headers: {
                                        get: (name: string) => name === 'x-completion-request-id' ? 'test-request-id' : null
                                    }
                                }
                            }));
                            result.withResponse = mockWithResponse;
                        }
                        return result;
                    }
                }
            }
        }))
    };
});

describe('GlamaHandler', () => {
    let handler: GlamaHandler;
    let mockOptions: ApiHandlerOptions;

    beforeEach(() => {
        mockOptions = {
            apiModelId: 'anthropic/claude-3-5-sonnet',
            glamaModelId: 'anthropic/claude-3-5-sonnet',
            glamaApiKey: 'test-api-key'
        };
        handler = new GlamaHandler(mockOptions);
        mockCreate.mockClear();
        mockWithResponse.mockClear();

        // Default mock implementation for non-streaming responses
        mockCreate.mockResolvedValue({
            id: 'test-completion',
            choices: [{
                message: { role: 'assistant', content: 'Test response' },
                finish_reason: 'stop',
                index: 0
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15
            }
        });
    });

    describe('constructor', () => {
        it('should initialize with provided options', () => {
            expect(handler).toBeInstanceOf(GlamaHandler);
            expect(handler.getModel().id).toBe(mockOptions.apiModelId);
        });
    });

    describe('createMessage', () => {
        const systemPrompt = 'You are a helpful assistant.';
        const messages: Anthropic.Messages.MessageParam[] = [
            {
                role: 'user',
                content: 'Hello!'
            }
        ];

        it('should handle streaming responses', async () => {
            // Mock axios for token usage request
            const mockAxios = jest.spyOn(axios, 'get').mockResolvedValueOnce({
                data: {
                    tokenUsage: {
                        promptTokens: 10,
                        completionTokens: 5,
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0
                    },
                    totalCostUsd: "0.00"
                }
            });

            const stream = handler.createMessage(systemPrompt, messages);
            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(2); // Text chunk and usage chunk
            expect(chunks[0]).toEqual({
                type: 'text',
                text: 'Test response'
            });
            expect(chunks[1]).toEqual({
                type: 'usage',
                inputTokens: 10,
                outputTokens: 5,
                cacheWriteTokens: 0,
                cacheReadTokens: 0,
                totalCost: 0
            });

            mockAxios.mockRestore();
        });

        it('should handle API errors', async () => {
            mockCreate.mockImplementationOnce(() => {
                throw new Error('API Error');
            });

            const stream = handler.createMessage(systemPrompt, messages);
            const chunks = [];

            try {
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                fail('Expected error to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect(error.message).toBe('API Error');
            }
        });
    });

    describe('completePrompt', () => {
        it('should complete prompt successfully', async () => {
            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
                model: mockOptions.apiModelId,
                messages: [{ role: 'user', content: 'Test prompt' }],
                temperature: 0,
                max_tokens: 8192
            }));
        });

        it('should handle API errors', async () => {
            mockCreate.mockRejectedValueOnce(new Error('API Error'));
            await expect(handler.completePrompt('Test prompt'))
                .rejects.toThrow('Glama completion error: API Error');
        });

        it('should handle empty response', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [{ message: { content: '' } }]
            });
            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('');
        });

        it('should not set max_tokens for non-Anthropic models', async () => {
            // Reset mock to clear any previous calls
            mockCreate.mockClear();
            
            const nonAnthropicOptions = {
                apiModelId: 'openai/gpt-4',
                glamaModelId: 'openai/gpt-4',
                glamaApiKey: 'test-key',
                glamaModelInfo: {
                    maxTokens: 4096,
                    contextWindow: 8192,
                    supportsImages: true,
                    supportsPromptCache: false
                }
            };
            const nonAnthropicHandler = new GlamaHandler(nonAnthropicOptions);

            await nonAnthropicHandler.completePrompt('Test prompt');
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'Test prompt' }],
                temperature: 0
            }));
            expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('max_tokens');
        });
    });

    describe('getModel', () => {
        it('should return model info', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe(mockOptions.apiModelId);
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(8192);
            expect(modelInfo.info.contextWindow).toBe(200_000);
        });
    });
});