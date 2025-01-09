import { LmStudioHandler } from '../lmstudio';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Mock OpenAI SDK
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: jest.fn()
            }
        }
    }))
}));

describe('LmStudioHandler', () => {
    let handler: LmStudioHandler;

    beforeEach(() => {
        handler = new LmStudioHandler({
            lmStudioModelId: 'mistral-7b',
            lmStudioBaseUrl: 'http://localhost:1234'
        });
    });

    describe('constructor', () => {
        it('should initialize with provided config', () => {
            expect(OpenAI).toHaveBeenCalledWith({
                baseURL: 'http://localhost:1234/v1',
                apiKey: 'noop'
            });
        });

        it('should use default base URL if not provided', () => {
            const defaultHandler = new LmStudioHandler({
                lmStudioModelId: 'mistral-7b'
            });

            expect(OpenAI).toHaveBeenCalledWith({
                baseURL: 'http://localhost:1234/v1',
                apiKey: 'noop'
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
                    choices: [{
                        delta: { content: 'Hello' }
                    }]
                },
                {
                    choices: [{
                        delta: { content: ' world!' }
                    }]
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
            (handler['client'].chat.completions as any).create = mockCreate;

            const stream = handler.createMessage(systemPrompt, mockMessages);
            const chunks = [];
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(2);
            expect(chunks[0]).toEqual({
                type: 'text',
                text: 'Hello'
            });
            expect(chunks[1]).toEqual({
                type: 'text',
                text: ' world!'
            });

            expect(mockCreate).toHaveBeenCalledWith({
                model: 'mistral-7b',
                messages: expect.arrayContaining([
                    {
                        role: 'system',
                        content: systemPrompt
                    }
                ]),
                temperature: 0,
                stream: true
            });
        });

        it('should handle API errors with custom message', async () => {
            const mockError = new Error('LM Studio API error');
            const mockCreate = jest.fn().mockRejectedValue(mockError);
            (handler['client'].chat.completions as any).create = mockCreate;

            const stream = handler.createMessage(systemPrompt, mockMessages);

            await expect(async () => {
                for await (const chunk of stream) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow('Please check the LM Studio developer logs to debug what went wrong');
        });
    });

    describe('getModel', () => {
        it('should return model info with sane defaults', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe('mistral-7b');
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(-1);
            expect(modelInfo.info.contextWindow).toBe(128_000);
        });

        it('should return empty string as model ID if not provided', () => {
            const noModelHandler = new LmStudioHandler({});
            const modelInfo = noModelHandler.getModel();
            expect(modelInfo.id).toBe('');
            expect(modelInfo.info).toBeDefined();
        });
    });
});