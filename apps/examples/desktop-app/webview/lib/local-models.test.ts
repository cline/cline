import { describe, expect, it } from "vitest";
import {
	evaluateLocalModelFit,
	getRecommendedLocalModel,
	normalizeOllamaModelName,
} from "./local-models";

const mac = (totalMemoryGb: number) => ({
	totalMemoryGb,
	unifiedMemory: true,
	gpus: [],
});
const pc = (totalMemoryGb: number, vramGb?: number) => ({
	totalMemoryGb,
	unifiedMemory: false,
	gpus: vramGb ? [{ name: "GPU", memoryGb: vramGb }] : [],
});

describe("local models", () => {
	it("rates fit against GPU memory first, then system memory", () => {
		expect(evaluateLocalModelFit(23, pc(64, 24))).toBe("great");
		expect(evaluateLocalModelFit(23, pc(32, 12))).toBe("slow");
		expect(evaluateLocalModelFit(56, pc(16, 8))).toBe("too-large");
		expect(evaluateLocalModelFit(10, pc(32))).toBe("slow");
	});

	it("recommends Qwen3.8 27B when it fits on the GPU", () => {
		expect(getRecommendedLocalModel(mac(32))?.id).toBe("qwen3.8:27b");
		expect(getRecommendedLocalModel(pc(32, 24))?.id).toBe("qwen3.8:27b");
	});

	it("falls back to smaller models on smaller machines", () => {
		expect(getRecommendedLocalModel(mac(24))?.id).toBe("gpt-oss:20b");
		expect(getRecommendedLocalModel(mac(16))?.id).toBe("qwen3:8b");
	});

	it("prefers mixture-of-experts models when only the CPU can run them", () => {
		expect(getRecommendedLocalModel(pc(32))?.id).toBe("gpt-oss:20b");
		expect(getRecommendedLocalModel(pc(4))).toBeUndefined();
	});

	it("treats untagged Ollama names as :latest", () => {
		expect(normalizeOllamaModelName("laguna-xs-2.1")).toBe(
			"laguna-xs-2.1:latest",
		);
		expect(normalizeOllamaModelName("qwen3.8:27b")).toBe("qwen3.8:27b");
	});
});
