import { describe, expect, it } from "vitest";
import type { DelegatedAgentRuntimeConfig } from "./delegated-agent";
import {
	buildSubAgentSystemPrompt,
	buildTeammateSystemPrompt,
} from "./subagent-prompts";

const PROFILE_BODY = "You are a reviewer. Focus on correctness.";

function makeConfig(
	overrides: Partial<DelegatedAgentRuntimeConfig> = {},
): DelegatedAgentRuntimeConfig {
	return {
		providerId: "cline",
		modelId: "model",
		cwd: "/repo",
		apiKey: "key",
		clineIdeName: "Terminal",
		clinePlatform: "linux",
		workspaceMetadata: '{"workspaces":{}}',
		...overrides,
	};
}

describe("buildSubAgentSystemPrompt", () => {
	it("fills the persona slot and keeps the agent harness for cline", () => {
		const prompt = buildSubAgentSystemPrompt(PROFILE_BODY, makeConfig());
		expect(prompt.startsWith(PROFILE_BODY)).toBe(true);
		expect(prompt).toContain("Environment you are running in:");
		expect(prompt).toContain("4. Working Directory: /repo");
		expect(prompt).toContain(
			"IMPORTANT: Always includes tool calls in your response until the task is completed.",
		);
		expect(prompt).toContain("# Workspace Configuration");
		expect(prompt).not.toContain("You are Cline, an AI coding agent.");
	});

	it("keeps the harness for non-cline providers without cline metadata", () => {
		const prompt = buildSubAgentSystemPrompt(
			PROFILE_BODY,
			makeConfig({ providerId: "openai" }),
		);
		expect(prompt.startsWith(PROFILE_BODY)).toBe(true);
		expect(prompt).toContain("Environment you are running in:");
		expect(prompt).toContain(
			"IMPORTANT: Always includes tool calls in your response until the task is completed.",
		);
		expect(prompt).not.toContain("# Workspace Configuration");
	});
});

describe("buildTeammateSystemPrompt", () => {
	it("injects the role prompt as rules under the default persona for cline", () => {
		const prompt = buildTeammateSystemPrompt(PROFILE_BODY, makeConfig());
		expect(prompt).toContain("You are Cline, an AI coding agent.");
		expect(prompt).toContain(`# Team Teammate Role\n${PROFILE_BODY}`);
	});

	it("returns the raw prompt for non-cline providers", () => {
		const prompt = buildTeammateSystemPrompt(
			PROFILE_BODY,
			makeConfig({ providerId: "openai" }),
		);
		expect(prompt).toBe(PROFILE_BODY);
	});
});
