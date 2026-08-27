import { describe, expect, it } from "vitest";
import { TeamTeammateSpecSchema } from "./schema";

describe("TeamTeammateSpecSchema", () => {
	it("persists the node identity required to reattach cloud teammates", () => {
		expect(
			TeamTeammateSpecSchema.parse({
				agentId: "reviewer",
				rolePrompt: "Review changes",
				execution: "cloud",
				cloudNodeId: "cnd-existing",
			}),
		).toEqual({
			agentId: "reviewer",
			rolePrompt: "Review changes",
			execution: "cloud",
			cloudNodeId: "cnd-existing",
		});
	});

	it("rejects incomplete or misplaced cloud node identity", () => {
		expect(
			TeamTeammateSpecSchema.safeParse({
				agentId: "reviewer",
				rolePrompt: "Review changes",
				execution: "cloud",
			}).success,
		).toBe(false);
		expect(
			TeamTeammateSpecSchema.safeParse({
				agentId: "local",
				rolePrompt: "Work locally",
				cloudNodeId: "cnd-wrong",
			}).success,
		).toBe(false);
	});
});
