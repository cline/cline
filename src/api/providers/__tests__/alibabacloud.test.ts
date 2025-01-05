import { describe, test, expect, vi } from 'vitest';
import { AlibabaCloudHandler } from '../alibabacloud';
import { ApiConfiguration } from '../../../shared/api';
import OpenAI from 'openai';

const mockCreate = vi.fn();

vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate
                }
            }
        }
    };
});

describe('AlibabaCloudHandler', () => {
    const mockConfiguration: ApiConfiguration = {
        apiProvider: 'alibabacloud',
        alibabaCloudApiKey: 'sk-test-key',
        alibabaCloudModelId: 'qwen-plus',
        alibabaCloudBaseUrl: 'https://test-base-url'
    };

    let handler: AlibabaCloudHandler;

    beforeEach(() => {
        mockCreate.mockClear();
        
        // Create the handler
        handler = new AlibabaCloudHandler(mockConfiguration);
    });

    test('should initialize with correct model', () => {
        const model = handler.getModel();
        expect(model.id).toBe('qwen-plus');
        expect(model.info.maxTokens).toBe(8192);
    });

    test('should throw error with invalid configuration', () => {
        const invalidConfig = { ...mockConfiguration, alibabaCloudApiKey: '' };
        expect(() => new AlibabaCloudHandler(invalidConfig)).toThrow('Invalid Alibaba Cloud API configuration');
    });

    test('createMessage should call OpenAI create method with correct parameters', async () => {
        // Setup the mock implementation
        mockCreate.mockImplementation(async function* () {
            yield { choices: [{ delta: { content: 'Hello' } }] };
            yield { choices: [{ delta: {} }] }; // End of stream
        });

        // Act
        const systemPrompt = 'You are a helpful assistant';
        const messages = [{ role: 'user', content: 'Hello' }];
        const streamGenerator = handler.createMessage(systemPrompt, messages);
        
        // Consume the stream to trigger the method call
        for await (const _ of streamGenerator) {
            // Just consume the stream
        }

        // Assert
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'qwen-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello' }
                ],
                stream: true
            })
        );
    });
});
