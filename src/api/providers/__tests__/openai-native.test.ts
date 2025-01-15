import { OpenAiNativeHandler } from '../openai-native';
import { ApiHandlerOptions } from '../../../shared/api';
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
                                    message: { role: 'assistant', content: 'Test response' },
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

describe('OpenAiNativeHandler', () => {
    let handler: OpenAiNativeHandler;
    let mockOptions: ApiHandlerOptions;

    beforeEach(() => {
        mockOptions = {
            apiModelId: 'gpt-4o',
            openAiNativeApiKey: 'test-api-key'
        };
        handler = new OpenAiNativeHandler(mockOptions);
        mockCreate.mockClear();
    });

    describe('constructor', () => {
        it('should initialize with provided options', () => {
            expect(handler).toBeInstanceOf(OpenAiNativeHandler);
            expect(handler.getModel().id).toBe(mockOptions.apiModelId);
        });

        it('should initialize with empty API key', () => {
            const handlerWithoutKey = new OpenAiNativeHandler({
                apiModelId: 'gpt-4o',
                openAiNativeApiKey: ''
            });
            expect(handlerWithoutKey).toBeInstanceOf(OpenAiNativeHandler);
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

        it('should handle API errors', async () => {
            mockCreate.mockRejectedValueOnce(new Error('API Error'));

            const stream = handler.createMessage(systemPrompt, messages);

            await expect(async () => {
                for await (const chunk of stream) {
                    // Should not reach here
                }
            }).rejects.toThrow('API Error');
        });
    });

    describe('completePrompt', () => {
        it('should complete prompt successfully with gpt-4o model', async () => {
            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(mockCreate).toHaveBeenCalledWith({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Test prompt' }],
                temperature: 0
            });
        });

        it('should complete prompt successfully with o1 model', async () => {
            handler = new OpenAiNativeHandler({
                apiModelId: 'o1',
                openAiNativeApiKey: 'test-api-key'
            });

            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(mockCreate).toHaveBeenCalledWith({
                model: 'o1',
                messages: [{ role: 'user', content: 'Test prompt' }]
            });
        });

        it('should complete prompt successfully with o1-preview model', async () => {
            handler = new OpenAiNativeHandler({
                apiModelId: 'o1-preview',
                openAiNativeApiKey: 'test-api-key'
            });

            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(mockCreate).toHaveBeenCalledWith({
                model: 'o1-preview',
                messages: [{ role: 'user', content: 'Test prompt' }]
            });
        });

        it('should complete prompt successfully with o1-mini model', async () => {
            handler = new OpenAiNativeHandler({
                apiModelId: 'o1-mini',
                openAiNativeApiKey: 'test-api-key'
            });

            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('Test response');
            expect(mockCreate).toHaveBeenCalledWith({
                model: 'o1-mini',
                messages: [{ role: 'user', content: 'Test prompt' }]
            });
        });

        it('should handle API errors', async () => {
            mockCreate.mockRejectedValueOnce(new Error('API Error'));
            await expect(handler.completePrompt('Test prompt'))
                .rejects.toThrow('OpenAI Native completion error: API Error');
        });

        it('should handle empty response', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [{ message: { content: '' } }]
            });
            const result = await handler.completePrompt('Test prompt');
            expect(result).toBe('');
        });
    });

    describe('getModel', () => {
        it('should return model info', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe(mockOptions.apiModelId);
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(4096);
            expect(modelInfo.info.contextWindow).toBe(128_000);
        });

        it('should handle undefined model ID', () => {
            const handlerWithoutModel = new OpenAiNativeHandler({
                openAiNativeApiKey: 'test-api-key'
            });
            const modelInfo = handlerWithoutModel.getModel();
            expect(modelInfo.id).toBe('gpt-4o'); // Default model
            expect(modelInfo.info).toBeDefined();
        });
    });
});