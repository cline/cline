import { describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession } from "../../types/session";
import {
	type PendingPromptQueueState,
	PendingPromptService,
	PendingPromptsController,
} from "./pending-prompt-service";

function createState(): PendingPromptQueueState {
	return { pendingPrompts: [] };
}

describe("PendingPromptService", () => {
	it("deduplicates prompts and prioritizes steer delivery", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		service.enqueue(state, { prompt: "second", delivery: "queue" });
		service.enqueue(state, { prompt: "first", delivery: "steer" });

		expect(
			service.list(state).map(({ prompt, delivery }) => ({ prompt, delivery })),
		).toEqual([
			{ prompt: "first", delivery: "steer" },
			{ prompt: "second", delivery: "queue" },
		]);
		expect(state.pendingPrompts).toHaveLength(2);
	});

	it("updates prompts and reorders when delivery changes", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		service.enqueue(state, { prompt: "second", delivery: "queue" });
		const queued = service.list(state);

		const edited = service.update(state, {
			sessionId: "sess-1",
			promptId: queued[0]?.id,
			prompt: "edited first",
		});
		expect(edited.updated).toBe(true);
		expect(edited.prompts.map((prompt) => prompt.prompt)).toEqual([
			"edited first",
			"second",
		]);

		const steered = service.update(state, {
			sessionId: "sess-1",
			promptId: queued[1]?.id,
			delivery: "steer",
		});
		expect(
			steered.prompts.map(({ prompt, delivery }) => ({ prompt, delivery })),
		).toEqual([
			{ prompt: "second", delivery: "steer" },
			{ prompt: "edited first", delivery: "queue" },
		]);
	});

	it("consumes steer prompts before queued turns", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "queued", delivery: "queue" });
		service.enqueue(state, { prompt: "steered", delivery: "steer" });

		const steered = service.consumeSteer(state);
		expect(steered.entry?.prompt).toBe("steered");
		expect(steered.prompts.map((prompt) => prompt.prompt)).toEqual(["queued"]);

		const queued = service.shiftNext(state);
		expect(queued.entry?.prompt).toBe("queued");
		expect(queued.prompts).toEqual([]);
	});

	it("deletes prompts and reports missing prompts without mutation", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "keep", delivery: "queue" });
		service.enqueue(state, { prompt: "remove", delivery: "queue" });
		const removeId = service.list(state)[1]?.id;

		const missing = service.delete(state, {
			sessionId: "sess-1",
			promptId: "missing",
		});
		expect(missing.removed).toBe(false);
		expect(missing.prompts.map((prompt) => prompt.prompt)).toEqual([
			"keep",
			"remove",
		]);

		const removed = service.delete(state, {
			sessionId: "sess-1",
			promptId: removeId,
		});
		expect(removed.removed).toBe(true);
		expect(removed.prompt?.prompt).toBe("remove");
		expect(removed.prompts.map((prompt) => prompt.prompt)).toEqual(["keep"]);
	});

	it("normalizes edited prompt text and rejects empty prompts", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		const queued = service.list(state);

		expect(() =>
			service.update(state, {
				sessionId: "sess-1",
				promptId: queued[0]?.id,
				prompt: "   ",
			}),
		).toThrow("prompt cannot be empty");
	});

	it("requeues a drained prompt when send fails", async () => {
		const sessionId = "sess-drain-failure";
		const session = {
			sessionId,
			pendingPrompts: [
				{
					id: "pending-1",
					prompt: "try later",
					delivery: "steer",
				},
			],
			aborting: false,
			drainingPendingPrompts: false,
			status: "completed",
			agent: {
				canStartRun: () => true,
			},
		} as unknown as ActiveSession;
		const events: CoreSessionEvent[] = [];
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send: vi.fn().mockRejectedValue(new Error("send failed")),
		});

		await controller.drain(sessionId);

		expect(controller.list(sessionId).map((prompt) => prompt.prompt)).toEqual([
			"try later",
		]);
		expect(
			events.some(
				(event) =>
					event.type === "pending_prompts" &&
					event.payload.prompts.length === 0,
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "pending_prompts" &&
					event.payload.prompts.some((prompt) => prompt.prompt === "try later"),
			),
		).toBe(true);
	});
});
