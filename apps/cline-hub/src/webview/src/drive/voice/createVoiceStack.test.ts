import {
	localDefaultsWithOllama,
	resolveTopologyFromFacets,
} from "@cline/drive";
import { describe, expect, it } from "vitest";
import { createVoiceStack } from "./createVoiceStack";

describe("createVoiceStack", () => {
	it("builds ports for a legal local topology", () => {
		const { facets, llm } = localDefaultsWithOllama();
		const resolved = resolveTopologyFromFacets({ facets, llm });
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		const stack = createVoiceStack(resolved.topology);
		expect(stack.stt.backend.kind).toBe("local-worker");
		expect(stack.tts.backend.kind).toBe("browser-speechSynthesis");
		expect(stack.stt.egress).toBe("loopback-only");
		expect(typeof stack.tts.speak).toBe("function");
		expect(typeof stack.tts.cancel).toBe("function");
	});

	it("memoizes identical topologies without recreating ports", () => {
		const { facets, llm } = localDefaultsWithOllama();
		const resolved = resolveTopologyFromFacets({ facets, llm });
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		const first = createVoiceStack(resolved.topology);
		const second = createVoiceStack({ ...resolved.topology });
		expect(second).toBe(first);
	});
});
