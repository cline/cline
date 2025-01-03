import { describe, it, expect } from 'vitest';
import { calculateApiCost } from "./cost"
import { ModelInfo } from "../shared/api"

describe("API Cost Calculation", () => {
  const mockModelInfo: ModelInfo = {
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheWritesPrice: 5.0,
    cacheReadsPrice: 1.0,
    supportsPromptCache: true
  };

  it("should calculate API cost correctly", () => {
    const cost = calculateApiCost(mockModelInfo, 1000, 500, 500, 250)
    
    // Breakdown of calculations:
    // Cache writes: (5.0 / 1_000_000) * 500 = 0.0025
    // Cache reads: (1.0 / 1_000_000) * 250 = 0.00025
    // Input: (3.0 / 1_000_000) * 1000 = 0.003
    // Output: (15.0 / 1_000_000) * 500 = 0.0075
    // Total: 0.0025 + 0.00025 + 0.003 + 0.0075 = 0.0133
    expect(cost).toBeCloseTo(0.0133, 4);
  });

  it("should handle missing prices", () => {
    const incompleteModelInfo: ModelInfo = {
      inputPrice: undefined,
      outputPrice: undefined,
      supportsPromptCache: false
    };

    const cost = calculateApiCost(incompleteModelInfo, 1000, 500);
    expect(cost).toBe(0);
  });

  it("should handle zero token counts", () => {
    const cost = calculateApiCost(mockModelInfo, 0, 0, 0, 0);
    expect(cost).toBe(0);
  });

  it("should calculate basic input/output costs", () => {
    const modelInfo: ModelInfo = {
      supportsPromptCache: false,
      inputPrice: 3.0, // $3 per million tokens
      outputPrice: 15.0, // $15 per million tokens
    }

    const cost = calculateApiCost(modelInfo, 1000, 500)
    // Input: (3.0 / 1_000_000) * 1000 = 0.003
    // Output: (15.0 / 1_000_000) * 500 = 0.0075
    // Total: 0.003 + 0.0075 = 0.0105
    expect(cost).toBe(0.0105)
  })

  it("should handle missing prices", () => {
    const modelInfo: ModelInfo = {
      supportsPromptCache: true,
      // No prices specified
    }

    const cost = calculateApiCost(modelInfo, 1000, 500)
    expect(cost).toBe(0)
  })

  it("should use real model configuration (Claude 3.5 Sonnet)", () => {
    const modelInfo: ModelInfo = {
      maxTokens: 8192,
      contextWindow: 200_000,
      supportsImages: true,
      supportsComputerUse: true,
      supportsPromptCache: true,
      inputPrice: 3.0,
      outputPrice: 15.0,
      cacheWritesPrice: 3.75,
      cacheReadsPrice: 0.3,
    }

    const cost = calculateApiCost(modelInfo, 2000, 1000, 1500, 500)
    // Cache writes: (3.75 / 1_000_000) * 1500 = 0.005625
    // Cache reads: (0.3 / 1_000_000) * 500 = 0.00015
    // Input: (3.0 / 1_000_000) * 2000 = 0.006
    // Output: (15.0 / 1_000_000) * 1000 = 0.015
    // Total: 0.005625 + 0.00015 + 0.006 + 0.015 = 0.026775
    expect(cost).toBe(0.026775)
  })

  it("should handle zero token counts", () => {
    const modelInfo: ModelInfo = {
      supportsPromptCache: true,
      inputPrice: 3.0,
      outputPrice: 15.0,
      cacheWritesPrice: 3.75,
      cacheReadsPrice: 0.3,
    }

    const cost = calculateApiCost(modelInfo, 0, 0, 0, 0)
    expect(cost).toBe(0)
  })
})
