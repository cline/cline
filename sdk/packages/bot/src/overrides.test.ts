import { describe, expect, it } from "vitest";
import { resolveBotSystemPrompt, resolveEffectiveConfig } from "./overrides";

describe("bot system prompt layers", () => {
	it("places the bundled prompt and profile rules before user instructions", () => {
		expect(
			resolveBotSystemPrompt({
				profileSystemPrompt: "You are Cline Dad.",
				profileRules: "Inspect before acting.",
				systemPrompt: "Call me Beatrix.",
			}),
		).toBe(
			"You are Cline Dad.\n\n---\n\nInspect before acting.\n\n---\n\nCall me Beatrix.",
		);
	});

	it("keeps the profile layer when a turn overrides user instructions", () => {
		const effective = resolveEffectiveConfig(
			{
				profileId: "cline-dad",
				profileSystemPrompt: "Bundled system prompt",
				profileRules: "Bundled rules",
				systemPrompt: "Stored custom instructions",
			},
			{ systemPrompt: "One-turn instructions" },
		);
		expect(resolveBotSystemPrompt(effective)).toBe(
			"Bundled system prompt\n\n---\n\nBundled rules\n\n---\n\nOne-turn instructions",
		);
	});
});
