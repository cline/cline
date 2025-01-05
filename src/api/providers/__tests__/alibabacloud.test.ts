import { AlibabaCloudHandler } from '../alibabacloud';
import { ApiConfiguration } from '../../../shared/api';

describe('AlibabaCloudHandler', () => {
    const mockConfiguration: ApiConfiguration = {
        apiProvider: 'alibabacloud',
        alibabaCloudApiKey: 'sk-test-key',
        alibabaCloudModelId: 'qwen-plus'
    };

    let handler: AlibabaCloudHandler;

    beforeEach(() => {
        handler = new AlibabaCloudHandler(mockConfiguration);
    });

    test('should initialize with correct model', () => {
        const model = handler.getModel();
        expect(model.id).toBe('qwen-plus');
        expect(model.info.maxTokens).toBe(8192);
    });

    test('should throw error with invalid configuration', () => {
        const invalidConfig = { ...mockConfiguration, alibabaCloudApiKey: '' };
        expect(() => new AlibabaCloudHandler(invalidConfig)).toThrow();
    });

    test('createMessage should handle streaming', async () => {
        const systemPrompt = 'You are a helpful assistant';
        const messages = [{ role: 'user', content: 'Hello' }];

        const streamGenerator = handler.createMessage(systemPrompt, messages);
        const chunks: string[] = [];

        for await (const chunk of streamGenerator) {
            chunks.push(chunk.content);
        }

        // This is a mock test, actual implementation would require mocking the API call
        expect(chunks.length).toBeGreaterThan(0);
    });
});
