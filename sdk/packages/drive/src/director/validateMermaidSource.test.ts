import { describe, expect, it } from "vitest";
import {
	assertMermaidSource,
	MermaidParseError,
	validateMermaidSource,
} from "./validateMermaidSource.js";

describe("validateMermaidSource", () => {
	it("accepts flowchart and graph sources", () => {
		expect(validateMermaidSource("flowchart LR\n  A --> B").ok).toBe(true);
		expect(validateMermaidSource("graph TD; A-->B;").ok).toBe(true);
	});

	it("rejects empty and fenced sources", () => {
		expect(validateMermaidSource("").ok).toBe(false);
		expect(validateMermaidSource("   ").ok).toBe(false);
		const fenced = validateMermaidSource(
			"```mermaid\nflowchart LR\nA-->B\n```",
		);
		expect(fenced.ok).toBe(false);
		if (!fenced.ok) {
			expect(fenced.reason).toContain("markdown fences");
		}
	});

	it("rejects prose without a diagram type", () => {
		const result = validateMermaidSource("just some explanation text");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("unrecognized mermaid diagram type");
		}
	});

	it("skips %% comments when finding the diagram type", () => {
		expect(
			validateMermaidSource("%% title\nsequenceDiagram\n  A->>B: hi").ok,
		).toBe(true);
	});

	it("assertMermaidSource throws MermaidParseError", () => {
		expect(() => assertMermaidSource("nope")).toThrow(MermaidParseError);
	});
});
