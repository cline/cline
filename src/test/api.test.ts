import { openAiNativeModels } from '../shared/api';
import { expect } from '@jest/globals';

describe('openAiNativeModels', () => {
	it('should contain the correct model configurations', () => {
		expect(openAiNativeModels).toHaveProperty('gpt-4o');
		expect(openAiNativeModels).toHaveProperty('gpt-4o-mini');
		expect(openAiNativeModels).toHaveProperty('o1-preview');
		expect(openAiNativeModels).toHaveProperty('o1-mini');
	});

	it('should have correct pricing for gpt-4o', () => {
		const model = openAiNativeModels['gpt-4o'];
		expect(model.inputPrice).toBe(2.50);
		expect(model.outputPrice).toBe(10.00);
		expect(model.cacheWritesPrice).toBe(1.25);
	});

	it('should have correct pricing for gpt-4o-mini', () => {
		const model = openAiNativeModels['gpt-4o-mini'];
		expect(model.inputPrice).toBe(0.15);
		expect(model.outputPrice).toBe(0.60);
		expect(model.cacheWritesPrice).toBe(0.075);
	});

	it('should have correct pricing for o1-preview', () => {
		const model = openAiNativeModels['o1-preview'];
		expect(model.inputPrice).toBe(15.00);
		expect(model.outputPrice).toBe(60.00);
		expect(model.cacheWritesPrice).toBe(7.50);
	});

	it('should have correct pricing for o1-mini', () => {
		const model = openAiNativeModels['o1-mini'];
		expect(model.inputPrice).toBe(3.00);
		expect(model.outputPrice).toBe(12.00);
		expect(model.cacheWritesPrice).toBe(1.50);
	});

	it('should have correct context window and other properties', () => {
		Object.values(openAiNativeModels).forEach(model => {
			expect(model.contextWindow).toBe(128_000);
			expect(model.supportsImages).toBe(true);
			expect(model.supportsPromptCache).toBe(true);
		});
	});
});
