import { GeminiHandler } from '../gemini';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContentStream: jest.fn()
        })
    }))
}));

describe('GeminiHandler', () => {
    let handler: GeminiHandler;

    beforeEach(() => {
        handler = new GeminiHandler({
            apiKey: 'test-key',
            apiModelId: 'gemini-2.0-flash-thinking-exp-1219',
            geminiApiKey: 'test-key'
        });
    });

    describe('constructor', () => {
        it('should initialize with provided config', () => {
            expect(handler['options'].geminiApiKey).toBe('test-key');
            expect(handler['options'].apiModelId).toBe('gemini-2.0-flash-thinking-exp-1219');
        });

        it('should throw if API key is missing', () => {
            expect(() => {
                new GeminiHandler({
                    apiModelId: 'gemini-2.0-flash-thinking-exp-1219',
                    geminiApiKey: ''
                });
            }).toThrow('API key is required for Google Gemini');
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

        it('should handle text messages correctly', async () => {
            // Mock the stream response
            const mockStream = {
                stream: [
                    { text: () => 'Hello' },
                    { text: () => ' world!' }
                ],
                response: {
                    usageMetadata: {
                        promptTokenCount: 10,
                        candidatesTokenCount: 5
                    }
                }
            };

            // Setup the mock implementation
            const mockGenerateContentStream = jest.fn().mockResolvedValue(mockStream);
            const mockGetGenerativeModel = jest.fn().mockReturnValue({
                generateContentStream: mockGenerateContentStream
            });

            (handler['client'] as any).getGenerativeModel = mockGetGenerativeModel;

            const stream = handler.createMessage(systemPrompt, mockMessages);
            const chunks = [];
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            // Should have 3 chunks: 'Hello', ' world!', and usage info
            expect(chunks.length).toBe(3);
            expect(chunks[0]).toEqual({
                type: 'text',
                text: 'Hello'
            });
            expect(chunks[1]).toEqual({
                type: 'text',
                text: ' world!'
            });
            expect(chunks[2]).toEqual({
                type: 'usage',
                inputTokens: 10,
                outputTokens: 5
            });

            // Verify the model configuration
            expect(mockGetGenerativeModel).toHaveBeenCalledWith({
                model: 'gemini-2.0-flash-thinking-exp-1219',
                systemInstruction: systemPrompt
            });

            // Verify generation config
            expect(mockGenerateContentStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    generationConfig: {
                        temperature: 0
                    }
                })
            );
        });

        it('should handle API errors', async () => {
            const mockError = new Error('Gemini API error');
            const mockGenerateContentStream = jest.fn().mockRejectedValue(mockError);
            const mockGetGenerativeModel = jest.fn().mockReturnValue({
                generateContentStream: mockGenerateContentStream
            });

            (handler['client'] as any).getGenerativeModel = mockGetGenerativeModel;

            const stream = handler.createMessage(systemPrompt, mockMessages);

            await expect(async () => {
                for await (const chunk of stream) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow('Gemini API error');
        });
    });

    describe('getModel', () => {
        it('should return correct model info', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe('gemini-2.0-flash-thinking-exp-1219');
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(8192);
            expect(modelInfo.info.contextWindow).toBe(32_767);
        });

        it('should return default model if invalid model specified', () => {
            const invalidHandler = new GeminiHandler({
                apiModelId: 'invalid-model',
                geminiApiKey: 'test-key'
            });
            const modelInfo = invalidHandler.getModel();
            expect(modelInfo.id).toBe('gemini-2.0-flash-thinking-exp-1219'); // Default model
        });
    });
});