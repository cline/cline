import { describe, expect, it } from "vitest";
import type { Participant } from "@cline/shared";
import { resolveAddress } from "./resolveAddress.js";

const participants: Participant[] = [
	{
		id: "h1",
		kind: "human",
		displayName: "You",
		role: "host",
		status: "idle",
	},
	{
		id: "a1",
		kind: "agent",
		displayName: "Ada",
		role: "partner",
		status: "idle",
		seatSources: [{ kind: "pack", packId: "review" }],
	},
	{
		id: "a2",
		kind: "agent",
		displayName: "Bea",
		role: "specialist",
		status: "idle",
		seatSources: [{ kind: "manual" }],
	},
];

describe("resolveAddress", () => {
	it("resolves everyone to seated agents", () => {
		const result = resolveAddress({
			addressSet: { mode: "everyone" },
			participants,
		});
		expect(result).toEqual({ ok: true, participantIds: ["a1", "a2"] });
	});

	it("intersects agents mode with seated ids", () => {
		expect(
			resolveAddress({
				addressSet: { mode: "agents", agentIds: ["a2", "gone"] },
				participants,
			}),
		).toEqual({ ok: true, participantIds: ["a2"] });

		expect(
			resolveAddress({
				addressSet: { mode: "agents", agentIds: ["gone"] },
				participants,
			}).ok,
		).toBe(false);
	});

	it("resolves pack mode from seatSources and fails closed when empty", () => {
		expect(
			resolveAddress({
				addressSet: { mode: "pack", packId: "review" },
				participants,
			}),
		).toEqual({ ok: true, participantIds: ["a1"] });

		const empty = resolveAddress({
			addressSet: { mode: "pack", packId: "missing" },
			participants,
		});
		expect(empty.ok).toBe(false);
		if (!empty.ok) {
			expect(empty.code).toBe("empty_address");
		}
	});
});
