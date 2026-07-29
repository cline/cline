import { describe, expect, it } from "vitest";
import {
	parsePromotePacket,
	parseSeedPacket,
	SeedPacketSchema,
} from "./chatFork";

describe("chatFork schemas", () => {
	it("parses a path_disjoint seed packet", () => {
		const seed = parseSeedPacket({
			doItemId: "do-1",
			title: "Fix flake",
			goal: "Stabilize auth test",
			parentBriefing: "Keep auth green",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: ["src/auth"],
			linkedShowTemplateIds: ["work.card"],
			workspace: { mode: "path_disjoint" },
			parentSessionId: "sess-main",
		});
		expect(seed.workspace.mode).toBe("path_disjoint");
	});

	it("requires worktreePath for worktree_isolated", () => {
		expect(() =>
			SeedPacketSchema.parse({
				doItemId: "do-1",
				title: "Fix flake",
				goal: "Stabilize auth test",
				parentBriefing: "Keep auth green",
				assigneeParticipantId: "agent-1",
				allowedPathPrefixes: [],
				linkedShowTemplateIds: [],
				workspace: { mode: "worktree_isolated" },
				parentSessionId: "sess-main",
			}),
		).toThrow();
	});

	it("parses a promote packet", () => {
		const promote = parsePromotePacket({
			workerSessionId: "sess-worker",
			doItemId: "do-1",
			status: "done",
			summary: "Fixed",
			decisions: ["Prefer waitFor"],
			showItemIds: ["show-1"],
			eventRefs: ["evt-1"],
			auditHandle: "audit-sess-worker",
			retainForAudit: true,
		});
		expect(promote.retainForAudit).toBe(true);
	});
});
