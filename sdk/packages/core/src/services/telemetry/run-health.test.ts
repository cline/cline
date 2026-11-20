import type { AgentMessage, AgentRuntimeEvent } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_IDLE_REPORT_MS, RunHealthObserver } from "./run-health";

function event(type: string, extra: object = {}): AgentRuntimeEvent {
	return {
		type,
		snapshot: { agentId: "agent-1", runId: "run-1" },
		...extra,
	} as unknown as AgentRuntimeEvent;
}

function assistantText(text: string): AgentRuntimeEvent {
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
	} as AgentMessage;
	return event("assistant-message", { message, finishReason: "stop" });
}

describe("RunHealthObserver", () => {
	let capture: ReturnType<typeof vi.fn>;
	let observer: RunHealthObserver;

	beforeEach(() => {
		vi.useFakeTimers();
		capture = vi.fn();
		observer = new RunHealthObserver({ capture } as never, {
			sessionId: "sess-1",
			isSubagent: false,
			providerId: "cline",
			modelId: "deepseek-v4-flash",
		});
		observer.observe(event("run-started"));
		observer.observe(event("turn-started"));
	});

	afterEach(() => {
		observer.dispose();
		vi.useRealTimers();
	});

	const idleEvents = () =>
		capture.mock.calls.filter(([call]) => call.event === "task.run_idle");

	it("reports a silent stream once while stuck and summarizes the run", () => {
		observer.observe(
			event("assistant-text-delta", { accumulatedText: "Let me check:" }),
		);
		vi.advanceTimersByTime(150_000);
		observer.observe(assistantText("Let me check the file:"));

		expect(idleEvents()).toEqual([
			[
				{
					event: "task.run_idle",
					properties: {
						ulid: "sess-1",
						agentId: "agent-1",
						runId: "run-1",
						idleMs: RUN_IDLE_REPORT_MS,
						lastEventType: "assistant-text-delta",
						isSubagent: false,
					},
				},
			],
		]);
		expect(observer.endProperties()).toMatchObject({
			sessionId: "sess-1",
			isSubagent: false,
			providerId: "cline",
			modelId: "deepseek-v4-flash",
			maxIdleMs: 150_000,
			maxIdleAfter: "assistant-text-delta",
			idleReported: true,
			finishReason: "stop",
			endedOn: "assistant_text",
			textSignature: "intent_without_action",
		});
	});

	it("treats streamed tool-call arguments as progress", () => {
		for (let elapsed = 0; elapsed < 3 * RUN_IDLE_REPORT_MS; elapsed += 10_000) {
			vi.advanceTimersByTime(10_000);
			observer.observe(event("tool-call-delta"));
		}
		expect(idleEvents()).toEqual([]);
		expect(observer.endProperties()).toMatchObject({
			maxIdleMs: 10_000,
			idleReported: false,
		});
	});

	it("counts the silence before the run ends", () => {
		observer.observe(assistantText("Done."));
		vi.advanceTimersByTime(90_000);
		expect(observer.endProperties()).toMatchObject({
			maxIdleMs: 90_000,
			maxIdleAfter: "assistant-message",
			msSinceLastEvent: 90_000,
			idleReported: true,
		});
	});

	it("labels a turn rejected before reaching history as empty", () => {
		observer.observe(assistantText("I'll run the tests now:"));
		observer.observe(event("turn-started"));
		observer.observe(event("run-failed"));
		expect(observer.endProperties()).toMatchObject({
			endedOn: "empty",
			textSignature: "empty_turn",
		});
	});

	it("does not sign a turn that failed mid-stream", () => {
		observer.observe(event("assistant-text-delta"));
		const properties = observer.endProperties();
		expect(properties.endedOn).toBe("unfinished");
		expect(properties).not.toHaveProperty("textSignature");
	});

	it("does not sign a media-only reply or carry an earlier turn's finish reason", () => {
		observer.observe(assistantText("Calling a tool."));
		observer.observe(event("turn-started"));
		observer.observe(
			event("assistant-message", {
				message: { role: "assistant", content: [{ type: "media" }] },
				finishReason: "stop",
			}),
		);
		const media = observer.endProperties();
		expect(media.endedOn).toBe("assistant_other");
		expect(media).not.toHaveProperty("textSignature");

		observer.observe(event("turn-started"));
		expect(observer.endProperties().finishReason).toBeUndefined();
	});

	it("stops checking once the run ends", () => {
		observer.endProperties();
		vi.advanceTimersByTime(5 * RUN_IDLE_REPORT_MS);
		expect(idleEvents()).toEqual([]);
	});
});
