import { describe, expect, it } from "vitest";
import type { DoBacklogItem, StageDirectorState } from "@cline/shared";
import {
	IllegalChatForkError,
	applyPromotePacket,
	assertForkLegal,
	buildSeedPacket,
} from "./chatForkPolicy.js";

const queuedDo: DoBacklogItem = {
	id: "do-1",
	title: "Fix flake",
	goal: "Stabilize auth test",
	priority: 10,
	status: "queued",
	dependsOn: [],
	source: "planner",
};

const emptyDirector: StageDirectorState = {
	doBacklog: [queuedDo],
	showBacklog: [
		{
			id: "show-1",
			ownerParticipantId: "agent-1",
			title: "Diff",
			intent: "show fix",
			artifactKind: "work.card",
			mediaClass: "work",
			caption: "auth test",
			produce: { tool: "work_card", args: {} },
			priority: 5,
			status: "planned",
			linkedDoItemId: "do-1",
			scoreReasons: [],
		},
	],
	activeScript: null,
	activeBeatId: null,
	activeShowId: null,
	stickyShowIds: [],
	spotlightParticipantId: null,
	lastPresentedAt: null,
};

describe("assertForkLegal", () => {
	it("allows path_disjoint when prefixes do not overlap", () => {
		expect(() =>
			assertForkLegal({
				reason: "do_claim",
				doItem: queuedDo,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
				activeForks: [
					{
						doItemId: "do-other",
						allowedPathPrefixes: ["src/docs"],
						workspaceMode: "path_disjoint",
					},
				],
			}),
		).not.toThrow();
	});

	it("rejects overlapping path prefixes", () => {
		expect(() =>
			assertForkLegal({
				reason: "wave_item",
				doItem: queuedDo,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
				activeForks: [
					{
						doItemId: "do-other",
						allowedPathPrefixes: ["src/auth/login"],
						workspaceMode: "path_disjoint",
					},
				],
			}),
		).toThrow(IllegalChatForkError);
	});

	it("rejects worktree_isolated without capability", () => {
		expect(() =>
			assertForkLegal({
				reason: "do_claim",
				doItem: queuedDo,
				workspace: {
					mode: "worktree_isolated",
					worktreePath: "/tmp/wt-1",
				},
				worktreeIsolationAvailable: false,
			}),
		).toThrow(/worktreeIsolation/);
	});

	it("rejects done do items", () => {
		expect(() =>
			assertForkLegal({
				reason: "do_claim",
				doItem: { ...queuedDo, status: "done" },
				workspace: { mode: "shared_readonly" },
			}),
		).toThrow(/not claimable/);
	});
});

describe("buildSeedPacket", () => {
	it("builds a compact seed from a do item", () => {
		const seed = buildSeedPacket({
			doItem: queuedDo,
			parentBriefing: "Keep auth green",
			assigneeParticipantId: "agent-1",
			parentSessionId: "sess-main",
			workspace: { mode: "path_disjoint" },
			allowedPathPrefixes: ["src/auth"],
			linkedShowTemplateIds: ["work.card"],
		});
		expect(seed.doItemId).toBe("do-1");
		expect(seed.parentBriefing).toBe("Keep auth green");
		expect(seed.allowedPathPrefixes).toEqual(["src/auth"]);
		expect(seed.parentSessionId).toBe("sess-main");
	});
});

describe("applyPromotePacket", () => {
	it("marks do done, promotes planned shows, and builds injection text", () => {
		const result = applyPromotePacket({
			state: emptyDirector,
			promote: {
				workerSessionId: "sess-worker",
				doItemId: "do-1",
				status: "done",
				summary: "Flake fixed by awaiting network idle",
				decisions: ["Prefer waitFor over sleep"],
				showItemIds: ["show-1"],
				eventRefs: ["evt-1"],
				auditHandle: "audit-sess-worker",
				retainForAudit: true,
			},
		});
		expect(result.state.doBacklog[0]?.status).toBe("done");
		expect(result.state.showBacklog[0]?.status).toBe("ready");
		expect(result.createdShowItemIds).toEqual([]);
		expect(result.lifecycle).toBe("archived");
		expect(result.mainContextInjection).toContain("Flake fixed");
		expect(result.mainContextInjection).toContain("Prefer waitFor");
	});

	it("drops lifecycle when retainForAudit is false", () => {
		const result = applyPromotePacket({
			state: emptyDirector,
			promote: {
				workerSessionId: "sess-worker",
				doItemId: "do-1",
				status: "failed",
				summary: "Could not reproduce",
				decisions: [],
				showItemIds: [],
				eventRefs: [],
				auditHandle: "audit-sess-worker",
				retainForAudit: false,
			},
		});
		expect(result.state.doBacklog[0]?.status).toBe("blocked");
		expect(result.lifecycle).toBe("dropped");
	});

	it("creates ready Show items from linkedShowTemplateIds when missing", () => {
		const result = applyPromotePacket({
			state: {
				...emptyDirector,
				showBacklog: [],
				doBacklog: [
					{
						...queuedDo,
						linkedShowTemplateIds: ["arch.overview"],
					},
				],
			},
			promote: {
				workerSessionId: "sess-worker",
				doItemId: "do-1",
				status: "done",
				summary: "Diagram ready",
				decisions: [],
				showItemIds: [],
				linkedShowTemplateIds: ["doc.plan"],
				eventRefs: [],
				auditHandle: "audit-sess-worker",
				retainForAudit: true,
			},
			ownerParticipantId: "agent-1",
			linkedShowTemplateIds: ["walk.code"],
		});
		expect(result.createdShowItemIds.length).toBe(3);
		const kinds = result.state.showBacklog.map((item) => item.artifactKind).sort();
		expect(kinds).toEqual([
			"diagram.architecture",
			"doc.plan",
			"walkthrough.code",
		]);
		for (const item of result.state.showBacklog) {
			expect(item.status).toBe("ready");
			expect(item.linkedDoItemId).toBe("do-1");
			expect(item.ownerParticipantId).toBe("agent-1");
		}
	});

	it("creates from showItemIds that match template ids", () => {
		const result = applyPromotePacket({
			state: { ...emptyDirector, showBacklog: [] },
			promote: {
				workerSessionId: "sess-worker",
				doItemId: "do-1",
				status: "done",
				summary: "Flow",
				decisions: [],
				showItemIds: ["flow.data"],
				eventRefs: [],
				auditHandle: "audit-sess-worker",
				retainForAudit: true,
			},
			ownerParticipantId: "agent-1",
		});
		expect(result.createdShowItemIds).toEqual(["flow.data"]);
		expect(result.state.showBacklog[0]).toMatchObject({
			id: "flow.data",
			artifactKind: "diagram.data_flow",
			status: "ready",
			linkedDoItemId: "do-1",
		});
	});
});
