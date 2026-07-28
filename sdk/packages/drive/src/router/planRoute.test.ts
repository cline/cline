import { describe, expect, it } from "vitest";
import type { SeatedAgentCard } from "@cline/shared";
import { assertRouteLegal, planRoute } from "./planRoute";

const partner: SeatedAgentCard = {
	participantId: "drive:partner",
	displayName: "Partner",
	role: "pair_partner",
	labels: ["coding"],
	domains: ["typescript"],
};

const specialist: SeatedAgentCard = {
	participantId: "drive:security",
	displayName: "Security",
	role: "specialist",
	labels: ["security", "threat"],
	domains: ["security"],
};

describe("planRoute P4 no-everyone-when-seated", () => {
	it("uses everyone only when no agents are seated", () => {
		const plan = planRoute({
			utterance: "hello",
			utteranceId: "u1",
			seated: [],
			mode: "auto",
		});
		expect(plan.slices[0]?.addressSet.mode).toBe("everyone");
		expect(plan.lowConfidence).toBe(true);
	});

	it("never widens to everyone when agents are seated (low confidence)", () => {
		const plan = planRoute({
			utterance: "zzzz unrelated",
			utteranceId: "u2",
			seated: [partner, specialist],
			mode: "auto",
			threshold: 10,
		});
		expect(plan.lowConfidence).toBe(true);
		for (const slice of plan.slices) {
			expect(slice.addressSet.mode).not.toBe("everyone");
			expect(slice.addressSet.mode).toBe("agents");
			if (slice.addressSet.mode === "agents") {
				expect(slice.addressSet.agentIds).toContain("drive:partner");
			}
		}
		expect(
			assertRouteLegal(
				plan,
				new Set(["drive:partner", "drive:security"]),
			).ok,
		).toBe(true);
	});

	it("routes high-confidence label hits to the matching agent", () => {
		const plan = planRoute({
			utterance: "please review the security threat model",
			utteranceId: "u3",
			seated: [partner, specialist],
			mode: "auto",
			threshold: 0.5,
		});
		expect(plan.lowConfidence).toBe(false);
		const address = plan.slices[0]?.addressSet;
		expect(address?.mode).toBe("agents");
		if (address?.mode === "agents") {
			expect(address.agentIds).toEqual(["drive:security"]);
		}
	});
});
