import { describe, expect, it } from "vitest";
import type { ChatForkRecord, DoBacklogItem } from "@cline/shared";
import {
	DEFAULT_MAX_CONCURRENT_CHAT_FORKS,
	tickChatForks,
} from "./chatForkLifecycle.js";

const doA: DoBacklogItem = {
	id: "a",
	title: "A",
	goal: "a",
	priority: 10,
	status: "queued",
	dependsOn: [],
	source: "planner",
};

const doB: DoBacklogItem = {
	id: "b",
	title: "B",
	goal: "b",
	priority: 5,
	status: "queued",
	dependsOn: [],
	source: "planner",
};

const doC: DoBacklogItem = {
	id: "c",
	title: "C",
	goal: "c",
	priority: 1,
	status: "queued",
	dependsOn: ["a"],
	source: "planner",
};

function forkRecord(doItemId: string): ChatForkRecord {
	return {
		workerSessionId: `w-${doItemId}`,
		lifecycle: "running",
		seed: {
			doItemId,
			title: doItemId,
			goal: doItemId,
			parentBriefing: "",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: [`src/${doItemId}`],
			linkedShowTemplateIds: [],
			workspace: { mode: "path_disjoint" },
			parentSessionId: "main",
		},
		promote: null,
		visibleToHuman: false,
	};
}

describe("tickChatForks", () => {
	it("returns claim intents up to concurrency", () => {
		const intents = tickChatForks({
			director: {
				doBacklog: [doA, doB, doC],
				showBacklog: [],
				activeScript: null,
				activeBeatId: null,
				activeShowId: null,
				stickyShowIds: [],
				spotlightParticipantId: null,
				lastPresentedAt: null,
			},
			chatForks: [],
			maxConcurrent: DEFAULT_MAX_CONCURRENT_CHAT_FORKS,
		});
		expect(intents.map((intent) => intent.doItem.id)).toEqual(["a", "b"]);
	});

	it("skips already claimed and unmet dependsOn", () => {
		const intents = tickChatForks({
			director: {
				doBacklog: [doA, doB, doC],
				showBacklog: [],
				activeScript: null,
				activeBeatId: null,
				activeShowId: null,
				stickyShowIds: [],
				spotlightParticipantId: null,
				lastPresentedAt: null,
			},
			chatForks: [forkRecord("a")],
			maxConcurrent: 2,
		});
		expect(intents.map((intent) => intent.doItem.id)).toEqual(["b"]);
	});
});
