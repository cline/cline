import { describe, expect, it } from "vitest";
import type { AgentMediaBag, SeatedAgentCard } from "@cline/shared";
import {
	advanceScriptBeat,
	buildDirectorStateFromBags,
	rankShowBacklog,
} from "./rankBacklogs.js";
import {
	assertDeliveryAllowed,
	assertRouteLegal,
	planRoute,
} from "../router/planRoute.js";

const testAgent: SeatedAgentCard = {
	participantId: "test-1",
	profileId: "tester",
	role: "specialist",
	labels: ["test", "flake", "qa"],
	domains: ["testing"],
};

const docsAgent: SeatedAgentCard = {
	participantId: "docs-1",
	profileId: "docs",
	role: "specialist",
	labels: ["docs", "readme"],
	domains: ["documentation"],
};

const partner: SeatedAgentCard = {
	participantId: "partner-1",
	profileId: "pair",
	role: "pair_partner",
	labels: ["pair"],
	domains: ["general"],
};

describe("planRoute", () => {
	it("routes flake fix to test specialist", () => {
		const plan = planRoute({
			utterance: "fix the flaky auth test",
			utteranceId: "u1",
			seated: [docsAgent, testAgent, partner],
			mode: "suggest",
			threshold: 0.5,
		});
		expect(plan.lowConfidence).toBe(false);
		expect(plan.slices[0]?.addressSet).toEqual({
			mode: "agents",
			agentIds: ["test-1"],
		});
	});

	it("falls back to pair partner on low confidence instead of everyone", () => {
		const plan = planRoute({
			utterance: "xyzzy unrelated jargon",
			utteranceId: "u-low",
			seated: [docsAgent, testAgent, partner],
			mode: "suggest",
			threshold: 50,
		});
		expect(plan.lowConfidence).toBe(true);
		expect(plan.slices[0]?.addressSet).toEqual({
			mode: "agents",
			agentIds: ["partner-1"],
		});
		expect(plan.slices[0]?.reasons).toContain(
			"low_confidence_fallback_partner",
		);
	});

	it("assertRouteLegal rejects unknown agents", () => {
		const plan = planRoute({
			utterance: "hello",
			utteranceId: "u2",
			seated: [partner],
			mode: "manual",
		});
		plan.slices[0] = {
			...plan.slices[0]!,
			addressSet: { mode: "agents", agentIds: ["missing"] },
		};
		const result = assertRouteLegal(plan, new Set(["partner-1"]));
		expect(result.ok).toBe(false);
	});
});

describe("assertDeliveryAllowed", () => {
	it("blocks muted speakers and deafened receivers", () => {
		const flags = [
			{ participantId: "a", muted: true, deafened: false },
			{ participantId: "b", muted: false, deafened: true },
		];
		expect(
			assertDeliveryAllowed({
				senderId: "a",
				receiverId: "b",
				flags,
				channel: "a2a",
				requireSpeak: true,
			}).ok,
		).toBe(false);
		expect(
			assertDeliveryAllowed({
				senderId: "partner-1",
				receiverId: "b",
				flags: [
					{ participantId: "partner-1", muted: false, deafened: false },
					flags[1]!,
				],
				channel: "room",
				requireSpeak: true,
			}).ok,
		).toBe(false);
	});
});

describe("rankShowBacklog", () => {
	it("biases spotlight owner", () => {
		const items = [
			{
				id: "s-docs",
				ownerParticipantId: "docs-1",
				title: "Docs",
				intent: "docs",
				artifactKind: "doc.plan" as const,
				mediaClass: "document" as const,
				caption: "",
				produce: { tool: "doc", args: {} },
				priority: 50,
				status: "ready" as const,
				scoreReasons: [],
			},
			{
				id: "s-test",
				ownerParticipantId: "test-1",
				title: "Arch",
				intent: "architecture",
				artifactKind: "diagram.architecture" as const,
				mediaClass: "still" as const,
				caption: "",
				produce: { tool: "mermaid", args: {} },
				priority: 10,
				status: "ready" as const,
				scoreReasons: [],
			},
		];
		const ranked = rankShowBacklog({
			items,
			spotlightParticipantId: "test-1",
		});
		expect(ranked[0]?.item.id).toBe("s-test");
		expect(ranked[0]?.reasons).toContain("spotlight_owner");
	});
});

describe("advanceScriptBeat", () => {
	it("keeps sticky show across beats", () => {
		const bag: AgentMediaBag = {
			participantId: "test-1",
			showBacklog: [
				{
					id: "show-1",
					ownerParticipantId: "test-1",
					title: "Arch",
					intent: "explain",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					caption: "diagram",
					produce: { tool: "mermaid", args: {} },
					priority: 1,
					status: "ready",
					scoreReasons: [],
				},
			],
			scripts: [
				{
					scriptId: "scr-1",
					ownerParticipantId: "test-1",
					title: "Walkthrough",
					stickyShowIds: ["show-1"],
					beats: [
						{
							beatId: "b1",
							say: "First",
							showItemId: "show-1",
							sticky: { mode: "hold" },
							advance: "auto_after_say",
						},
						{
							beatId: "b2",
							say: "Second",
							showItemId: "show-1",
							sticky: { mode: "hold" },
							advance: "auto_after_say",
						},
					],
				},
			],
		};
		const state = buildDirectorStateFromBags({
			bags: [bag],
			doBacklog: [],
			spotlightParticipantId: "test-1",
		});
		const next = advanceScriptBeat({
			state,
			script: bag.scripts[0]!,
		});
		expect(next.activeBeatId).toBe("b2");
		expect(next.stickyShowIds).toContain("show-1");
		expect(next.activeShowId).toBe("show-1");
	});
});
