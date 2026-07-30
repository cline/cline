import type { ChatForkRecord, ShowBacklogItem } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { isChatForkSession, showIdsForFork } from "./chatForkSession";

describe("isChatForkSession", () => {
	it("detects chatFork metadata", () => {
		expect(isChatForkSession({ chatFork: true })).toBe(true);
		expect(isChatForkSession({ isSubagent: true })).toBe(true);
		expect(isChatForkSession({ source: "hub" })).toBe(false);
		expect(isChatForkSession(null)).toBe(false);
	});
});

describe("showIdsForFork", () => {
	const fork: ChatForkRecord = {
		workerSessionId: "w1",
		lifecycle: "archived",
		seed: {
			doItemId: "do-1",
			title: "Fix",
			goal: "g",
			parentBriefing: "",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: [],
			linkedShowTemplateIds: ["arch.overview"],
			workspace: { mode: "shared_readonly" },
			parentSessionId: "main",
		},
		promote: {
			workerSessionId: "w1",
			doItemId: "do-1",
			status: "done",
			summary: "ok",
			decisions: [],
			showItemIds: ["show-packet"],
			eventRefs: [],
			auditHandle: "w1",
			retainForAudit: true,
		},
		visibleToHuman: false,
	};

	const backlog: ShowBacklogItem[] = [
		{
			id: "show_arch.overview_do-1",
			ownerParticipantId: "agent-1",
			title: "Architecture overview",
			intent: "Explain",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			caption: "",
			produce: {
				tool: "render_mermaid",
				templateId: "arch.overview",
				args: {},
			},
			priority: 10,
			status: "ready",
			linkedDoItemId: "do-1",
			scoreReasons: [],
		},
	];

	it("merges promote showItemIds with linked backlog rows", () => {
		expect(showIdsForFork(fork, backlog)).toEqual([
			"show-packet",
			"show_arch.overview_do-1",
		]);
	});
});
