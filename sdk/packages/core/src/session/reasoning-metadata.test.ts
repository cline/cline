import { describe, expect, it } from "vitest";
import {
	readSessionReasoningMetadata,
	withSessionReasoningMetadata,
} from "./reasoning-metadata";

describe("session reasoning metadata", () => {
	it("reports nothing when a session recorded no selection", () => {
		expect(readSessionReasoningMetadata(undefined)).toBeUndefined();
		expect(readSessionReasoningMetadata({})).toBeUndefined();
		expect(
			readSessionReasoningMetadata({ thinking: "yes", reasoningEffort: 3 }),
		).toBeUndefined();
	});

	it("reads a recorded selection", () => {
		expect(
			readSessionReasoningMetadata({
				thinking: true,
				reasoningEffort: "high",
			}),
		).toEqual({ thinking: true, reasoningEffort: "high" });
	});

	it("leaves metadata untouched when the selection carries nothing", () => {
		const metadata = { title: "Existing" };
		expect(withSessionReasoningMetadata(metadata, {})).toEqual(metadata);
		expect(
			withSessionReasoningMetadata(metadata, { reasoningEffort: "extreme" }),
		).toEqual(metadata);
	});

	it("records the selection", () => {
		expect(
			withSessionReasoningMetadata(undefined, {
				thinking: true,
				reasoningEffort: "medium",
			}),
		).toEqual({ thinking: true, reasoningEffort: "medium" });
	});

	it("treats a bare level as thinking enabled", () => {
		expect(
			withSessionReasoningMetadata(
				{ title: "Existing" },
				{
					reasoningEffort: "xhigh",
				},
			),
		).toEqual({
			title: "Existing",
			thinking: true,
			reasoningEffort: "xhigh",
		});
	});

	it("drops a stale level when thinking is switched off", () => {
		expect(
			withSessionReasoningMetadata(
				{ thinking: true, reasoningEffort: "high" },
				{ thinking: false },
			),
		).toEqual({ thinking: false });
	});
});
