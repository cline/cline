import type {
	AgendaTaskRecord,
	HubFactoryActivityPayload,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "../../types/events";
import {
	FactoryActivityPublisher,
	type FactoryActivitySession,
	summarizeFactoryToolInput,
} from "./factory-activity";

const toolStart = (
	sessionId: string,
	toolName: string,
	input: unknown,
): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: {
				type: "content_start",
				contentType: "tool",
				toolName,
				toolCallId: `call-${toolName}`,
				input,
			},
		},
	}) as CoreSessionEvent;

afterEach(() => {
	vi.useRealTimers();
});

function setup(
	sessions: Record<string, FactoryActivitySession>,
	task?: Partial<AgendaTaskRecord>,
) {
	const published: HubFactoryActivityPayload[] = [];
	let now = Date.parse("2026-11-11T12:00:00.000Z");
	const resolveSession = vi.fn(async (id: string) => sessions[id]);
	const publisher = new FactoryActivityPublisher({
		resolveSession,
		getTask: () => task as AgendaTaskRecord | undefined,
		publish: (payload) => published.push(payload),
		intervalMs: 400,
		now: () => now,
	});
	return {
		publisher,
		published,
		resolveSession,
		advance: (ms: number) => {
			now += ms;
			vi.advanceTimersByTime(ms);
		},
	};
}

describe("FactoryActivityPublisher", () => {
	it("publishes one bounded event for a Factory role session's tool start", async () => {
		const { publisher, published } = setup({
			builder: { taskId: "task_1", role: "builder" },
		});
		const secret = `GITHUB_TOKEN=${"z".repeat(40)}`;
		publisher.handle(
			toolStart("builder", "run_commands", {
				commands: [
					`${secret} bun test src/very/long/${"path/".repeat(40)}file.test.ts`,
				],
			}),
		);
		await vi.waitFor(() => expect(published).toHaveLength(1));
		const [event] = published;
		expect(event).toMatchObject({
			taskId: "task_1",
			sessionId: "builder",
			role: "builder",
			toolName: "run_commands",
			at: "2026-11-11T12:00:00.000Z",
		});
		expect(event?.summary).toMatch(/^Running GITHUB_TOKEN=… bun test/);
		expect(event?.input?.command?.length).toBeLessThanOrEqual(80);
		expect(JSON.stringify(event)).not.toContain("z".repeat(32));
	});

	it("carries the card's short id when it has one", async () => {
		const { publisher, published } = setup(
			{ builder: { taskId: "task_1", role: "builder" } },
			{ taskId: "task_1", factoryNumber: 42 },
		);
		publisher.handle(toolStart("builder", "read_files", { files: ["/a.ts"] }));
		await vi.waitFor(() => expect(published).toHaveLength(1));
		expect(published[0]).toMatchObject({ taskId: "task_1", factoryId: "F42" });
	});

	it("publishes nothing for an ordinary chat session", async () => {
		const { publisher, published, resolveSession } = setup({});
		publisher.handle(toolStart("chat", "read_files", { files: ["/a.ts"] }));
		publisher.handle(toolStart("chat", "read_files", { files: ["/b.ts"] }));
		await vi.waitFor(() => expect(resolveSession).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(published).toEqual([]);
		// The session is resolved once, not per event.
		expect(resolveSession).toHaveBeenCalledTimes(1);
	});

	it("throttles each session and sends the latest start after the window", async () => {
		vi.useFakeTimers();
		const { publisher, published, advance } = setup({
			verifier: { taskId: "task_1", role: "verifier" },
		});
		publisher.handle(toolStart("verifier", "read_files", { files: ["/a.ts"] }));
		await vi.waitFor(() => expect(published).toHaveLength(1));
		publisher.handle(toolStart("verifier", "read_files", { files: ["/b.ts"] }));
		publisher.handle(toolStart("verifier", "read_files", { files: ["/c.ts"] }));
		await vi.advanceTimersByTimeAsync(0);
		expect(published).toHaveLength(1);
		advance(400);
		await vi.waitFor(() => expect(published).toHaveLength(2));
		expect(published[1]?.summary).toBe("Reading c.ts");
	});

	it("names a designer-role session listed as a plan reviewer", async () => {
		const { publisher, published } = setup(
			{ reviewer: { taskId: "task_1", role: "designer" } },
			{
				factoryDesignProgress: {
					phase: "reviewing",
					designerSessionId: "designer",
					reviewerSessions: [{ reviewerIndex: 0, sessionId: "reviewer" }],
				} as never,
			},
		);
		publisher.handle(
			toolStart("reviewer", "search_codebase", { queries: ["factory queue"] }),
		);
		await vi.waitFor(() => expect(published).toHaveLength(1));
		expect(published[0]).toMatchObject({
			role: "plan_reviewer",
			summary: "Searching for factory queue",
		});
	});
});

describe("summarizeFactoryToolInput", () => {
	it("keeps one short path and never file contents", () => {
		expect(
			summarizeFactoryToolInput("editor", {
				command: "create",
				path: "/tmp/worktrees/abc/src/api/routes.ts",
				file_text: "secret contents",
			}),
		).toEqual({
			input: { path: "src/api/routes.ts" },
			summary: "Editing src/api/routes.ts",
		});
		expect(
			summarizeFactoryToolInput("apply_patch", {
				input: "*** Begin Patch\n*** Update File: src/a.ts\n+contents\n",
			}),
		).toEqual({ input: { path: "src/a.ts" }, summary: "Editing src/a.ts" });
		expect(
			summarizeFactoryToolInput("ask_question", { question: "?" }),
		).toEqual({ summary: "Asking a question" });
	});
});
