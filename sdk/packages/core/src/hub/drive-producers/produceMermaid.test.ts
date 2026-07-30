import { describe, expect, it, beforeEach } from "vitest";
import {
	__clearMermaidCacheForTests,
	MermaidParseError,
	produceMermaidShowArtifact,
} from "./produceMermaid";

describe("produceMermaidShowArtifact", () => {
	beforeEach(() => {
		__clearMermaidCacheForTests();
	});

	it("produces a data-uri SVG show item", () => {
		const result = produceMermaidShowArtifact({
			templateId: "arch.overview",
			mermaidSource: "graph TD; A-->B;",
			ownerParticipantId: "agent-1",
		});
		expect(result.cacheHit).toBe(false);
		expect(result.item.uri?.startsWith("data:image/svg+xml")).toBe(true);
		expect(result.item.artifactKind).toBe("diagram.architecture");
		expect(result.svg).toContain("graph TD");
	});

	it("caches identical mermaid source", () => {
		const first = produceMermaidShowArtifact({
			mermaidSource: "graph TD; A-->B;",
			ownerParticipantId: "agent-1",
		});
		const second = produceMermaidShowArtifact({
			mermaidSource: "graph TD; A-->B;",
			ownerParticipantId: "agent-1",
		});
		expect(first.cacheHit).toBe(false);
		expect(second.cacheHit).toBe(true);
		expect(second.item.uri).toBe(first.item.uri);
	});

	it("fails closed on invalid mermaidSource", () => {
		expect(() =>
			produceMermaidShowArtifact({
				mermaidSource: "not a diagram",
				ownerParticipantId: "agent-1",
			}),
		).toThrow(MermaidParseError);
	});
});
