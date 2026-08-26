import { describe, expect, test } from "bun:test";
import { AGENT_ROLES, createAgentConfig } from "./index";

describe("multi-agent war room example", () => {
	test("spawns exactly the four documented specialist agents with unique ids", () => {
		expect(AGENT_ROLES.map((a) => a.id)).toEqual([
			"architect",
			"security",
			"pragmatist",
			"skeptic",
		]);
		const ids = new Set(AGENT_ROLES.map((a) => a.id));
		expect(ids.size).toBe(AGENT_ROLES.length);
		for (const agent of AGENT_ROLES) {
			expect(agent.role.length).toBeGreaterThan(0);
		}
	});

	test("every agent prompt embeds the mission topic", () => {
		const topic = "<mission-topic>";
		for (const agent of AGENT_ROLES) {
			const prompt = agent.prompt(topic);
			expect(prompt).toContain(topic);
			expect(prompt.length).toBeGreaterThan(20);
		}
	});

	test("createAgentConfig reads credentials from CLINE_API_KEY", () => {
		const previous = process.env.CLINE_API_KEY;
		try {
			process.env.CLINE_API_KEY = "test-key";
			const config = createAgentConfig();
			expect(config.apiKey).toBe("test-key");
			expect(config.providerId).toBe("cline");
			expect(config.modelId).toStartWith("anthropic/");
		} finally {
			if (previous === undefined) {
				delete process.env.CLINE_API_KEY;
			} else {
				process.env.CLINE_API_KEY = previous;
			}
		}
	});
});
