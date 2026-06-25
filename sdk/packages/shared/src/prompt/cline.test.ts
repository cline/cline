import { describe, expect, it } from "vitest";
import { buildClineSystemPrompt } from "./cline";
import { DEFAULT_CLINE_PERSONA } from "./system";

const PERSONA = "You are Reviewer, a meticulous code review agent.";

describe("buildClineSystemPrompt", () => {
	it("uses the default persona when no personaPrompt is provided", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			platform: "linux",
		});
		expect(prompt).toContain("You are Cline, an AI coding agent.");
		expect(prompt).toContain("4. Working Directory: /repo");
	});

	it("applies personaPrompt while keeping the harness", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			platform: "linux",
			ide: "Terminal",
			personaPrompt: PERSONA,
		});
		expect(prompt.startsWith(PERSONA)).toBe(true);
		expect(prompt).toContain("1. Platform: linux");
		expect(prompt).toContain("4. Working Directory: /repo");
		expect(prompt).toContain(
			"IMPORTANT: Always includes tool calls in your response until the task is completed.",
		);
		expect(prompt).not.toContain(DEFAULT_CLINE_PERSONA);
	});

	it("appends workspace metadata for the cline provider with a persona", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			providerId: "cline",
			personaPrompt: PERSONA,
			metadata: '{"workspaces":{}}',
		});
		expect(prompt.startsWith(PERSONA)).toBe(true);
		expect(prompt).toContain("# Workspace Configuration");
	});

	it("does not duplicate metadata when the persona already embeds it", () => {
		const personaWithMetadata = `${PERSONA}\n\n# Workspace Configuration\n{"workspaces":{}}`;
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			providerId: "cline",
			personaPrompt: personaWithMetadata,
			metadata: '{"workspaces":{}}',
		});
		const markerCount = prompt.split("# Workspace Configuration").length - 1;
		expect(markerCount).toBe(1);
	});

	it("omits workspace metadata for non-cline providers with a persona", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			providerId: "openai",
			personaPrompt: PERSONA,
			metadata: '{"workspaces":{}}',
		});
		expect(prompt.startsWith(PERSONA)).toBe(true);
		expect(prompt).not.toContain("# Workspace Configuration");
	});

	it("lets overridePrompt win over personaPrompt", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			overridePrompt: "Full override.",
			personaPrompt: PERSONA,
		});
		expect(prompt).toBe("Full override.");
	});

	it("ignores personaPrompt in yolo mode", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			mode: "yolo",
			personaPrompt: PERSONA,
		});
		expect(prompt).toContain(
			"You are Cline, a careful and helpful coding agent that works in the background.",
		);
		expect(prompt).not.toContain(PERSONA);
	});

	it("inserts rules containing replacement patterns literally", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			rules: "Use $& and $' carefully.",
		});
		expect(prompt).toContain("Use $& and $' carefully.");
	});

	it("keeps template-like tokens inside the persona literal", () => {
		const persona =
			"You report {{PLATFORM_NAME}} and honor {{CLINE_RULES}} verbatim.";
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/repo",
			platform: "linux",
			personaPrompt: persona,
			rules: "Real rules here.",
		});
		expect(prompt.startsWith(persona)).toBe(true);
		expect(prompt).toContain("1. Platform: linux");
		expect(prompt).toContain("Real rules here.");
	});
});
