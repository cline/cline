import { openAiNativeModels } from '../shared/api';
import { expect, describe, it } from '@jest/globals';

describe('openAiNativeModels', () => {
	it('should contain the correct model configurations', () => {
		expect(openAiNativeModels).toHaveProperty('gpt-4o');
		expect(openAiNativeModels).toHaveProperty('gpt-4o-mini');
		expect(openAiNativeModels).toHaveProperty('o1-preview');
		expect(openAiNativeModels).toHaveProperty('o1-mini');
	});

	describe('Model pricing', () => {
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
	});

	it('should have correct context window and other properties', () => {
		Object.values(openAiNativeModels).forEach(model => {
			expect(model.contextWindow).toBe(128_000);
			expect(model.supportsImages).toBe(true);
			expect(model.supportsPromptCache).toBe(true);
		});
	});

	describe('Cost calculations', () => {
		const calculateCost = (model: any, inputTokens: number, outputTokens: number, cachedTokens: number = 0) => {
			const inputCost = (inputTokens / 1_000_000) * model.inputPrice;
			const outputCost = (outputTokens / 1_000_000) * model.outputPrice;
			const cacheCost = (cachedTokens / 1_000_000) * (model.cacheWritesPrice || 0);
			return inputCost + outputCost + cacheCost;
		};

		describe('gpt-4o', () => {
			const model = openAiNativeModels['gpt-4o'];

			it('should calculate correct cost with prompt caching', () => {
				expect(calculateCost(model, 1000, 500, 800)).toBeCloseTo(0.0085, 5);
			});

			it('should calculate correct cost without caching', () => {
				expect(calculateCost(model, 2000, 1000)).toBeCloseTo(0.015, 5);
			});
		});

		describe('gpt-4o-mini', () => {
			const model = openAiNativeModels['gpt-4o-mini'];

			it('should calculate correct cost with prompt caching', () => {
				expect(calculateCost(model, 1500, 700, 1000)).toBeCloseTo(0.00072, 5);
			});

			it('should calculate correct cost without caching', () => {
				expect(calculateCost(model, 3000, 1500)).toBeCloseTo(0.00135, 5);
			});
		});

		describe('o1-preview', () => {
			const model = openAiNativeModels['o1-preview'];

			it('should calculate correct cost with prompt caching', () => {
				expect(calculateCost(model, 2000, 1000, 1500)).toBeCloseTo(0.10125, 5);
			});

			it('should calculate correct cost without caching', () => {
				expect(calculateCost(model, 4000, 2000)).toBeCloseTo(0.18, 5);
			});
		});

		describe('o1-mini', () => {
			const model = openAiNativeModels['o1-mini'];

			it('should calculate correct cost with prompt caching', () => {
				expect(calculateCost(model, 2500, 1200, 2000)).toBeCloseTo(0.0249, 4);
			});

			it('should calculate correct cost without caching', () => {
				expect(calculateCost(model, 5000, 2500)).toBeCloseTo(0.045, 5);
			});
		});
	});
});
