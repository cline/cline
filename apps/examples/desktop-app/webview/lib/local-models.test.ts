import { describe, expect, it } from "vitest";
import {
	evaluateLocalModelFit,
	getMachineMemoryBytes,
	getRecommendedLocalModel,
	normalizeLocalModelName,
	parseOllamaParameters,
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
		expect(getRecommendedLocalModel(mac(32))?.ids.ollama).toBe("qwen3.8:27b");
		expect(getRecommendedLocalModel(pc(32, 24))?.ids.ollama).toBe(
			"qwen3.8:27b",
		);
	});

	it("falls back to smaller models on smaller machines", () => {
		expect(getRecommendedLocalModel(mac(24))?.ids.ollama).toBe("gpt-oss:20b");
		expect(getRecommendedLocalModel(mac(16))?.ids.ollama).toBe("qwen3:8b");
	});

	it("prefers mixture-of-experts models when only the CPU can run them", () => {
		expect(getRecommendedLocalModel(pc(32))?.ids.ollama).toBe("gpt-oss:20b");
		expect(getRecommendedLocalModel(pc(4))).toBeUndefined();
	});

	it("treats untagged Ollama names as :latest but keeps LM Studio keys", () => {
		expect(normalizeLocalModelName("ollama", "laguna-xs-2.1")).toBe(
			"laguna-xs-2.1:latest",
		);
		expect(normalizeLocalModelName("ollama", "qwen3.8:27b")).toBe(
			"qwen3.8:27b",
		);
		expect(normalizeLocalModelName("lmstudio", "qwen/qwen3-8b")).toBe(
			"qwen/qwen3-8b",
		);
	});

	it("parses ollama show parameters, keeping repeated stop sequences", () => {
		expect(
			parseOllamaParameters(
				[
					"repeat_penalty                 1",
					'stop                           "<|im_start|>"',
					'stop                           "<|im_end|>"',
					"temperature                    0.6",
					"",
				].join("\n"),
			),
		).toEqual({
			repeat_penalty: ["1"],
			stop: ["<|im_start|>", "<|im_end|>"],
			temperature: ["0.6"],
		});
		expect(parseOllamaParameters("")).toEqual({});
	});

	it("counts dedicated GPU memory but not unified memory twice", () => {
		expect(getMachineMemoryBytes(pc(32, 24))).toBe(56 * 1024 ** 3);
		expect(getMachineMemoryBytes(mac(32))).toBe(32 * 1024 ** 3);
	});
});
