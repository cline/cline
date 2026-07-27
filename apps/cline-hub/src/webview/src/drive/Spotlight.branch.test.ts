import { describe, expect, it } from "vitest";

/**
 * Human vs agent Spotlight branch rules (mirrors Spotlight.tsx props).
 */
function spotlightBranch(input: {
	stageSharer: "you" | "agent";
	hubPin: { kind: string; label: string; ref?: string } | null;
}): {
	humanPin: typeof input.hubPin;
	humanSharing: boolean;
	suppressAgentCards: boolean;
} {
	const humanSharing = input.stageSharer === "you";
	const humanPin = humanSharing ? input.hubPin : null;
	return {
		humanPin,
		humanSharing,
		suppressAgentCards: Boolean(humanPin) && humanSharing,
	};
}

describe("Spotlight human/agent branch", () => {
	it("shows hub pin only when you share; no optimistic invent", () => {
		expect(
			spotlightBranch({
				stageSharer: "you",
				hubPin: null,
			}),
		).toEqual({
			humanPin: null,
			humanSharing: true,
			suppressAgentCards: false,
		});

		expect(
			spotlightBranch({
				stageSharer: "you",
				hubPin: {
					kind: "selection",
					label: "block",
					ref: "const x = 1",
				},
			}).humanPin?.ref,
		).toBe("const x = 1");
	});

	it("hides pin and does not suppress cards when agent shares", () => {
		const branch = spotlightBranch({
			stageSharer: "agent",
			hubPin: { kind: "file", label: "a.ts" },
		});
		expect(branch.humanPin).toBeNull();
		expect(branch.suppressAgentCards).toBe(false);
	});
});
