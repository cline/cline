import { describe, expect, it } from "vitest";
import {
	checkRepeatedToolCall,
	createLoopDetectionState,
	resetLoopDetectionState,
	toolCallSignature,
} from "./loop-detection.js";

const DEFAULT_CONFIG = { softThreshold: 3, hardThreshold: 5 };

describe("toolCallSignature", () => {
	it("produces identical output regardless of key order", () => {
		expect(toolCallSignature({ b: "2", a: "1" })).toBe(
			toolCallSignature({ a: "1", b: "2" }),
		);
	});

	it("handles null/undefined", () => {
		expect(toolCallSignature(null)).toBe("null");
		expect(toolCallSignature(undefined)).toBe("null");
	});

	it("handles string input", () => {
		expect(toolCallSignature("hello")).toBe("hello");
	});

	it("distinguishes nested objects with different keys", () => {
		expect(toolCallSignature({ a: { x: 1 } })).not.toBe(
			toolCallSignature({ a: { y: 2 } }),
		);
	});

	it("normalizes nested key order", () => {
		expect(toolCallSignature({ a: { z: 1, y: 2 } })).toBe(
			toolCallSignature({ a: { y: 2, z: 1 } }),
		);
	});

	it("handles arrays within objects", () => {
		const a = { items: [1, 2, 3], name: "x" };
		const b = { name: "x", items: [1, 2, 3] };
		expect(toolCallSignature(a)).toBe(toolCallSignature(b));
	});
});

describe("checkRepeatedToolCall", () => {
	it("warns at soft threshold and escalates at hard threshold", () => {
		const state = createLoopDetectionState();
		const sig = toolCallSignature({ command: "python test.py" });
		const results = [];
		for (let i = 0; i < DEFAULT_CONFIG.hardThreshold; i++) {
			results.push(
				checkRepeatedToolCall(state, "run_commands", sig, DEFAULT_CONFIG),
			);
		}
		expect(results[0].softWarning).toBe(false);
		expect(results[1].softWarning).toBe(false);
		expect(results[2].softWarning).toBe(true);
		expect(results[2].hardEscalation).toBe(false);
		expect(results[3].hardEscalation).toBe(false);
		expect(results[4].hardEscalation).toBe(true);
	});

	it("resets counter when tool name changes", () => {
		const state = createLoopDetectionState();
		checkRepeatedToolCall(state, "run_commands", "sig1", DEFAULT_CONFIG);
		checkRepeatedToolCall(state, "run_commands", "sig1", DEFAULT_CONFIG);
		const r = checkRepeatedToolCall(state, "editor", "sig1", DEFAULT_CONFIG);
		expect(r.softWarning).toBe(false);
		expect(state.consecutiveIdenticalCount).toBe(1);
	});

	it("resets counter when args change", () => {
		const state = createLoopDetectionState();
		checkRepeatedToolCall(state, "run_commands", "sig1", DEFAULT_CONFIG);
		checkRepeatedToolCall(state, "run_commands", "sig1", DEFAULT_CONFIG);
		const r = checkRepeatedToolCall(
			state,
			"run_commands",
			"sig2",
			DEFAULT_CONFIG,
		);
		expect(r.softWarning).toBe(false);
		expect(state.consecutiveIdenticalCount).toBe(1);
	});

	it("re-arms after explicit state reset", () => {
		const state = createLoopDetectionState();
		for (let i = 0; i < 5; i++) {
			checkRepeatedToolCall(state, "t", "s", DEFAULT_CONFIG);
		}
		resetLoopDetectionState(state);
		const results = [];
		for (let i = 0; i < 5; i++) {
			results.push(checkRepeatedToolCall(state, "t", "s", DEFAULT_CONFIG));
		}
		expect(results[2].softWarning).toBe(true);
		expect(results[4].hardEscalation).toBe(true);
	});

	it("does not false-positive on different tools with same args", () => {
		const state = createLoopDetectionState();
		checkRepeatedToolCall(state, "run_commands", "s", DEFAULT_CONFIG);
		checkRepeatedToolCall(state, "editor", "s", DEFAULT_CONFIG);
		checkRepeatedToolCall(state, "read_file", "s", DEFAULT_CONFIG);
		expect(state.consecutiveIdenticalCount).toBe(1);
	});

	it("respects custom thresholds", () => {
		const cfg = { softThreshold: 2, hardThreshold: 3 };
		const state = createLoopDetectionState();
		checkRepeatedToolCall(state, "t", "s", cfg);
		expect(checkRepeatedToolCall(state, "t", "s", cfg).softWarning).toBe(true);
		expect(checkRepeatedToolCall(state, "t", "s", cfg).hardEscalation).toBe(
			true,
		);
	});
});
