import { describe, expect, it } from "vitest";

/**
 * Human vs agent Stage branch rules (mirrors Stage.tsx props).
 */
function stageBranch(input: {
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

describe("Stage human/agent branch", () => {
	it("shows hub pin only when you share; no optimistic invent", () => {
		expect(
			stageBranch({
				stageSharer: "you",
				hubPin: null,
			}),
		).toEqual({
			humanPin: null,
			humanSharing: true,
			suppressAgentCards: false,
		});

		expect(
			stageBranch({
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
		const branch = stageBranch({
			stageSharer: "agent",
			hubPin: { kind: "file", label: "a.ts" },
		});
		expect(branch.humanPin).toBeNull();
		expect(branch.suppressAgentCards).toBe(false);
	});
});
