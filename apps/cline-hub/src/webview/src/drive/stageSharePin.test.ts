import { describe, expect, it, vi } from "vitest";
import { buildHumanPinDefaults } from "./pinDefaults";
import type { StageCard } from "@cline/shared";

describe("buildHumanPinDefaults for Share pin", () => {
	it("prefers edit and command cards for file/terminal pins", () => {
		const cards: StageCard[] = [
			{
				id: "c1",
				category: "edit",
				title: "router.ts",
				summary: "src/router.ts",
				workEventId: "w1",
				updatedAt: "2026-07-29T00:00:00.000Z",
			},
			{
				id: "c2",
				category: "command",
				title: "bun test",
				summary: "ok",
				workEventId: "w2",
				updatedAt: "2026-07-29T00:00:01.000Z",
			},
		];
		const defaults = buildHumanPinDefaults(cards);
		expect(defaults.file.label).toBe("router.ts");
		expect(defaults.terminal.label).toBe("bun test");
		expect(defaults.selection.kind).toBe("selection");
	});
});

describe("Share pin stage payload shape", () => {
	it("builds call_set_stage human+pin and agent return payloads", () => {
		const humanPin = buildHumanPinDefaults([])["file"];
		const takeStage = {
			type: "call_set_stage" as const,
			roomId: "default",
			sharer: { kind: "human" as const, participantId: "drive:human" },
			pin: humanPin,
		};
		expect(takeStage.sharer.kind).toBe("human");
		expect(takeStage.pin?.kind).toBe("file");

		const returnSpotlight = {
			type: "call_set_stage" as const,
			roomId: "default",
			sharer: { kind: "agent" as const, participantId: "drive:partner" },
			pin: null,
		};
		expect(returnSpotlight.pin).toBeNull();
		expect(returnSpotlight.sharer.kind).toBe("agent");
		vi.fn(); // keep vitest import used if tree-shaken otherwise
	});
});
