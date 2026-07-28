import { describe, expect, it } from "vitest";
import {
	defaultStickyForArtifactKind,
	parseAgentMediaBag,
	parseStageDirectorState,
} from "./director";
import { parseAddressSet, parseRoutePlan } from "./router";
import { DemoArtifactRefSchema, ShareModeSchema } from "./share";

describe("share schemas", () => {
	it("accepts animation mediaKind", () => {
		const ref = DemoArtifactRefSchema.parse({
			artifactId: "a1",
			mediaKind: "animation",
			uri: "blob:demo",
			caption: "flow reveal",
			createdAt: "2026-07-27T12:00:00.000Z",
		});
		expect(ref.mediaKind).toBe("animation");
	});

	it("parses share modes", () => {
		expect(ShareModeSchema.parse("demo")).toBe("demo");
	});
});

describe("router schemas", () => {
	it("rejects empty agent address set", () => {
		expect(() =>
			parseAddressSet({ mode: "agents", agentIds: [] }),
		).toThrow();
	});

	it("parses a single-slice route plan", () => {
		const plan = parseRoutePlan({
			utteranceId: "u1",
			mode: "suggest",
			lowConfidence: false,
			slices: [
				{
					sliceId: "s1",
					start: 0,
					end: 4,
					text: "fix",
					addressSet: { mode: "agents", agentIds: ["a1"] },
					score: 1,
					reasons: ["label:test"],
				},
			],
		});
		expect(plan.slices).toHaveLength(1);
	});
});

describe("director schemas", () => {
	it("defaults sticky hold for architecture diagrams", () => {
		expect(defaultStickyForArtifactKind("diagram.architecture")).toEqual({
			mode: "hold",
		});
	});

	it("parses an agent media bag with script", () => {
		const bag = parseAgentMediaBag({
			participantId: "agent-1",
			voiceSlotId: "voice-a",
			showBacklog: [
				{
					id: "show-1",
					ownerParticipantId: "agent-1",
					title: "Arch",
					intent: "explain layout",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					caption: "system diagram",
					produce: { tool: "render_mermaid", args: {} },
					priority: 10,
					status: "ready",
					scoreReasons: [],
				},
			],
			scripts: [
				{
					scriptId: "scr-1",
					ownerParticipantId: "agent-1",
					title: "Explain arch",
					stickyShowIds: ["show-1"],
					beats: [
						{
							beatId: "b1",
							say: "Here is the layout.",
							showItemId: "show-1",
							sticky: { mode: "hold" },
							advance: "auto_after_say",
						},
					],
				},
			],
		});
		expect(bag.scripts[0]?.beats).toHaveLength(1);
	});

	it("parses stage director state with spotlight", () => {
		const state = parseStageDirectorState({
			doBacklog: [],
			showBacklog: [],
			activeScript: null,
			activeBeatId: null,
			activeShowId: null,
			stickyShowIds: [],
			spotlightParticipantId: "agent-1",
			lastPresentedAt: null,
		});
		expect(state.spotlightParticipantId).toBe("agent-1");
	});
});
