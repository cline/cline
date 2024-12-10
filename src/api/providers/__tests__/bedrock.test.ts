import { AwsBedrockHandler } from '../bedrock';
import { 
    BedrockRuntimeClient, 
    ConverseStreamCommand,
    ConverseStreamCommandOutput
} from '@aws-sdk/client-bedrock-runtime';
import { ApiHandlerOptions } from '../../../shared/api';
import { jest } from '@jest/globals';
import { Readable } from 'stream';

// Mock the BedrockRuntimeClient
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
        send: jest.fn()
    })),
    ConverseStreamCommand: jest.fn()
}));

describe('AwsBedrockHandler', () => {
    let handler: AwsBedrockHandler;
    let mockClient: jest.Mocked<BedrockRuntimeClient>;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();

        // Create mock client with properly typed send method
        mockClient = {
            send: jest.fn().mockImplementation(() => Promise.resolve({
                $metadata: {},
                stream: new Readable({
                    read() {
                        this.push(null);
                    }
                })
            }))
        } as unknown as jest.Mocked<BedrockRuntimeClient>;

        // Create handler with test options
        const options: ApiHandlerOptions = {
            awsRegion: 'us-west-2',
            awsAccessKey: 'test-access-key',
            awsSecretKey: 'test-secret-key',
            apiModelId: 'test-model'
        };
        handler = new AwsBedrockHandler(options);
        (handler as any).client = mockClient;
    });

    test('createMessage sends a streaming request correctly', async () => {
        const mockStream = new Readable({
            read() {
                this.push(JSON.stringify({
                    messageStart: { role: 'assistant' }
                }));
                this.push(JSON.stringify({
                    contentBlockStart: {
                        start: { text: 'Hello' }
                    }
                }));
                this.push(JSON.stringify({
                    contentBlockDelta: {
                        delta: { text: ' world' }
                    }
                }));
                this.push(JSON.stringify({
                    messageStop: { stopReason: 'end_turn' }
                }));
                this.push(null);
            }
        });

        mockClient.send.mockImplementation(() => 
            Promise.resolve({
                $metadata: {},
                stream: mockStream
            } as ConverseStreamCommandOutput)
        );

        const systemPrompt = 'Test system prompt';
        const messages = [{ role: 'user' as const, content: 'Test message' }];

        const stream = handler.createMessage(systemPrompt, messages);

        // Collect all chunks
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        // Verify the command was sent correctly
        expect(mockClient.send).toHaveBeenCalledWith(
            expect.any(ConverseStreamCommand)
        );

        // Verify the stream chunks
        expect(chunks).toEqual([
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' world' }
        ]);
    });

    test('createMessage handles metadata events correctly', async () => {
        const mockStream = new Readable({
            read() {
                this.push(JSON.stringify({
                    metadata: {
                        usage: {
                            inputTokens: 10,
                            outputTokens: 20,
                            totalTokens: 30
                        }
                    }
                }));
                this.push(null);
            }
        });

        mockClient.send.mockImplementation(() => 
            Promise.resolve({
                $metadata: {},
                stream: mockStream
            } as ConverseStreamCommandOutput)
        );

        const systemPrompt = 'Test system prompt';
        const messages = [{ role: 'user' as const, content: 'Test message' }];

        const stream = handler.createMessage(systemPrompt, messages);

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual([
            {
                type: 'usage',
                inputTokens: 10,
                outputTokens: 20
            }
        ]);
    });

    test('createMessage handles errors during streaming', async () => {
        mockClient.send.mockImplementation(() => 
            Promise.reject(new Error('Test error'))
        );

        const systemPrompt = 'Test system prompt';
        const messages = [{ role: 'user' as const, content: 'Test message' }];

        await expect(handler.createMessage(systemPrompt, messages)).rejects.toThrow('Test error');
    });

    test('getModel returns correct model info', () => {
        const modelInfo = handler.getModel();
        expect(modelInfo).toEqual({
            id: 'test-model',
            info: expect.any(Object)
        });
    });

    test('createMessage handles cross-region inference', async () => {
        const options: ApiHandlerOptions = {
            awsRegion: 'us-west-2',
            awsAccessKey: 'test-access-key',
            awsSecretKey: 'test-secret-key',
            apiModelId: 'test-model',
            awsUseCrossRegionInference: true
        };
        
        handler = new AwsBedrockHandler(options);
        (handler as any).client = mockClient;

        const mockStream = new Readable({
            read() {
                this.push(JSON.stringify({
                    contentBlockStart: {
                        start: { text: 'Hello' }
                    }
                }));
                this.push(null);
            }
        });

        mockClient.send.mockImplementation(() => 
            Promise.resolve({
                $metadata: {},
                stream: mockStream
            } as ConverseStreamCommandOutput)
        );

        const systemPrompt = 'Test system prompt';
        const messages = [{ role: 'user' as const, content: 'Test message' }];

        await handler.createMessage(systemPrompt, messages);

        expect(mockClient.send).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.stringContaining('us.test-model')
            })
        );
    });

    test('createMessage includes prompt cache configuration when enabled', async () => {
        const options: ApiHandlerOptions = {
            awsRegion: 'us-west-2',
            awsAccessKey: 'test-access-key',
            awsSecretKey: 'test-secret-key',
            apiModelId: 'test-model',
            awsUsePromptCache: true,
            awspromptCacheId: 'test-cache-id'
        };
        
        handler = new AwsBedrockHandler(options);
        (handler as any).client = mockClient;

        const mockStream = new Readable({
            read() {
                this.push(null);
            }
        });

        mockClient.send.mockImplementation(() => 
            Promise.resolve({
                $metadata: {},
                stream: mockStream
            } as ConverseStreamCommandOutput)
        );

        const systemPrompt = 'Test system prompt';
        const messages = [{ role: 'user' as const, content: 'Test message' }];

        await handler.createMessage(systemPrompt, messages);

        expect(mockClient.send).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.stringContaining('promptCacheId')
            })
        );
    });
});
