import { describe, expect, it } from "vitest";
import type { ShowBacklogItem } from "@cline/shared";
import {
	normalizeEnqueuedShowStatus,
	pickNextShowToPresent,
} from "./pickNextShow.js";

function item(
	partial: Partial<ShowBacklogItem> & Pick<ShowBacklogItem, "id" | "priority">,
): ShowBacklogItem {
	return {
		ownerParticipantId: "drive:partner",
		title: partial.id,
		intent: "test",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		caption: partial.id,
		produce: { tool: "render_mermaid", args: { mermaidSource: "A-->B" } },
		status: "ready",
		scoreReasons: [],
		...partial,
	};
}

describe("pickNextShowToPresent", () => {
	it("returns null for empty backlog", () => {
		expect(
			pickNextShowToPresent({
				items: [],
				spotlightParticipantId: null,
			}),
		).toBeNull();
	});

	it("picks higher priority when spotlight does not bias", () => {
		const picked = pickNextShowToPresent({
			items: [
				item({ id: "low", priority: 1 }),
				item({ id: "high", priority: 50 }),
			],
			spotlightParticipantId: null,
		});
		expect(picked?.id).toBe("high");
	});

	it("applies spotlight owner bias over raw priority", () => {
		const picked = pickNextShowToPresent({
			items: [
				item({
					id: "other",
					priority: 90,
					ownerParticipantId: "drive:other",
				}),
				item({
					id: "spot",
					priority: 1,
					ownerParticipantId: "drive:partner",
				}),
			],
			spotlightParticipantId: "drive:partner",
		});
		expect(picked?.id).toBe("spot");
	});

	it("honors preferShowId when still ranked", () => {
		const picked = pickNextShowToPresent({
			items: [
				item({ id: "a", priority: 10 }),
				item({ id: "b", priority: 20 }),
			],
			spotlightParticipantId: null,
			preferShowId: "a",
		});
		expect(picked?.id).toBe("a");
	});

	it("skips showing/cancelled items", () => {
		const picked = pickNextShowToPresent({
			items: [
				item({ id: "showing", priority: 100, status: "showing" }),
				item({ id: "ready", priority: 1, status: "ready" }),
			],
			spotlightParticipantId: null,
		});
		expect(picked?.id).toBe("ready");
	});
});

describe("normalizeEnqueuedShowStatus", () => {
	it("keeps ready, otherwise planned", () => {
		expect(normalizeEnqueuedShowStatus("ready")).toBe("ready");
		expect(normalizeEnqueuedShowStatus("planned")).toBe("planned");
		expect(normalizeEnqueuedShowStatus("showing")).toBe("planned");
		expect(normalizeEnqueuedShowStatus("shown")).toBe("planned");
		expect(normalizeEnqueuedShowStatus("cancelled")).toBe("planned");
	});
});
