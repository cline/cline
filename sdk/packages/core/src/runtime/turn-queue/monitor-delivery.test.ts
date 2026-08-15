/**
 * Monitor output reaches a session the same way a typed interruption does, so
 * it works unchanged when the hub runs the session: the daemon hosts a
 * LocalRuntimeHost, its PendingPromptsController emits `pending_prompts` and
 * `pending_prompt_submitted`, and the hub's session event projector forwards
 * both to every subscribed client.
 */
import { describe, expect, it, vi } from "vitest";
import {
	formatMonitorNotification,
	MonitorRegistry,
} from "../../extensions/tools";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession } from "../../types/session";
import { PendingPromptsController } from "./pending-prompt-service";

function createSession(
	sessionId: string,
	overrides: Partial<{ canStartRun: boolean; status: string }> = {},
): ActiveSession {
	return {
		sessionId,
		pendingPrompts: [],
		aborting: false,
		drainingPendingPrompts: false,
		status: overrides.status ?? "running",
		agent: { canStartRun: () => overrides.canStartRun ?? false },
	} as unknown as ActiveSession;
}

/** Mirrors the notifier LocalRuntimeHost installs for every session. */
function createHostNotifier(
	controller: PendingPromptsController,
	sessionId: string,
) {
	return (notification: Parameters<typeof formatMonitorNotification>[0]) => {
		controller.enqueue(sessionId, {
			prompt: formatMonitorNotification(notification),
			delivery: "steer",
		});
	};
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe("monitor delivery into a session", () => {
	it("emits the events the hub projects to clients", async () => {
		const sessionId = "sess-monitor-hub";
		// canStartRun false models a turn already in flight: the notification
		// waits in the queue for the agent's next iteration rather than trying
		// to start a second turn.
		const session = createSession(sessionId, { canStartRun: false });
		const events: CoreSessionEvent[] = [];
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send: vi.fn().mockResolvedValue(undefined),
		});
		const registry = new MonitorRegistry({
			notifier: createHostNotifier(controller, sessionId),
			flushIntervalMs: 20,
		});

		try {
			registry.start({
				name: "ci",
				command: "printf 'build failed\\n'",
				description: "CI status for PR #42",
			});

			await waitFor(() =>
				events.some((event) => event.type === "pending_prompts"),
			);

			// This is the event the projector turns into
			// `session.pending_prompts` for every subscribed hub client.
			const emitted = events.find(
				(event) => event.type === "pending_prompts",
			) as Extract<CoreSessionEvent, { type: "pending_prompts" }>;
			expect(emitted.payload.sessionId).toBe(sessionId);
			expect(emitted.payload.prompts[0]?.prompt).toContain("build failed");
			expect(emitted.payload.prompts[0]?.prompt).toContain(
				"[monitor: ci] CI status for PR #42",
			);
			expect(emitted.payload.prompts[0]?.delivery).toBe("steer");
		} finally {
			registry.dispose();
		}
	});

	it("starts a turn when the monitor fires while the session is idle", async () => {
		const sessionId = "sess-monitor-idle";
		const session = createSession(sessionId, { canStartRun: true });
		const send = vi.fn().mockResolvedValue(undefined);
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: () => {},
			send,
		});
		const registry = new MonitorRegistry({
			notifier: createHostNotifier(controller, sessionId),
			flushIntervalMs: 20,
		});

		try {
			registry.start({
				name: "deploy",
				command: "printf 'rollout complete\\n'",
				description: "deployment status",
			});

			await waitFor(() => send.mock.calls.length > 0);
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					prompt: expect.stringContaining("rollout complete"),
				}),
			);
		} finally {
			registry.dispose();
		}
	});
});
