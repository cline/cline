import { AwsBedrockHandler } from '../bedrock';
import { MessageContent } from '../../../shared/api';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { Anthropic } from '@anthropic-ai/sdk';

describe('AwsBedrockHandler', () => {
    let handler: AwsBedrockHandler;

    beforeEach(() => {
        handler = new AwsBedrockHandler({
            apiModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            awsAccessKey: 'test-access-key',
            awsSecretKey: 'test-secret-key',
            awsRegion: 'us-east-1'
        });
    });

    describe('constructor', () => {
        it('should initialize with provided config', () => {
            expect(handler['options'].awsAccessKey).toBe('test-access-key');
            expect(handler['options'].awsSecretKey).toBe('test-secret-key');
            expect(handler['options'].awsRegion).toBe('us-east-1');
            expect(handler['options'].apiModelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
        });

        it('should initialize with missing AWS credentials', () => {
            const handlerWithoutCreds = new AwsBedrockHandler({
                apiModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                awsRegion: 'us-east-1'
            });
            expect(handlerWithoutCreds).toBeInstanceOf(AwsBedrockHandler);
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
            const mockResponse = {
                messages: [{
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hello! How can I help you?' }]
                }],
                usage: {
                    input_tokens: 10,
                    output_tokens: 5
                }
            };

            // Mock AWS SDK invoke
            const mockStream = {
                [Symbol.asyncIterator]: async function* () {
                    yield {
                        metadata: {
                            usage: {
                                inputTokens: 10,
                                outputTokens: 5
                            }
                        }
                    };
                }
            };

            const mockInvoke = jest.fn().mockResolvedValue({
                stream: mockStream
            });

            handler['client'] = {
                send: mockInvoke
            } as unknown as BedrockRuntimeClient;

            const stream = handler.createMessage(systemPrompt, mockMessages);
            const chunks = [];
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0]).toEqual({
                type: 'usage',
                inputTokens: 10,
                outputTokens: 5
            });

            expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
                })
            }));
        });

        it('should handle API errors', async () => {
            // Mock AWS SDK invoke with error
            const mockInvoke = jest.fn().mockRejectedValue(new Error('AWS Bedrock error'));

            handler['client'] = {
                send: mockInvoke
            } as unknown as BedrockRuntimeClient;

            const stream = handler.createMessage(systemPrompt, mockMessages);

            await expect(async () => {
                for await (const chunk of stream) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow('AWS Bedrock error');
        });
    });

    describe('getModel', () => {
        it('should return correct model info in test environment', () => {
            const modelInfo = handler.getModel();
            expect(modelInfo.id).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
            expect(modelInfo.info).toBeDefined();
            expect(modelInfo.info.maxTokens).toBe(5000); // Test environment value
            expect(modelInfo.info.contextWindow).toBe(128_000); // Test environment value
        });

        it('should return test model info for invalid model in test environment', () => {
            const invalidHandler = new AwsBedrockHandler({
                apiModelId: 'invalid-model',
                awsAccessKey: 'test-access-key',
                awsSecretKey: 'test-secret-key',
                awsRegion: 'us-east-1'
            });
            const modelInfo = invalidHandler.getModel();
            expect(modelInfo.id).toBe('invalid-model'); // In test env, returns whatever is passed
            expect(modelInfo.info.maxTokens).toBe(5000);
            expect(modelInfo.info.contextWindow).toBe(128_000);
        });
    });
});
