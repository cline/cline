import { describe, expect, test } from "bun:test";
import type { HubEvent, HubLinkStatus } from "../hub/link";
import { type EngineLink, NextTurnEngine } from "./engine";
import { NotifyGate } from "./notify";

type Sent = { name: string; payload?: Record<string, unknown> };

function fakeLink(
	replies: Record<string, Record<string, unknown> | Error> = {},
) {
	const listeners = new Set<(event: HubEvent) => void>();
	const statusListeners = new Set<(status: HubLinkStatus) => void>();
	const sent: Sent[] = [];
	let disposed = false;
	const link: EngineLink & {
		emit(event: HubEvent): void;
		up(): void;
		sent: Sent[];
		disposed(): boolean;
	} = {
		sent,
		disposed: () => disposed,
		onStatus(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		async start() {},
		subscribe(names, listener) {
			const filtered = (event: HubEvent) => {
				if (names.has(event.event)) listener(event);
			};
			listeners.add(filtered);
			return () => listeners.delete(filtered);
		},
		async command(name, payload) {
			sent.push({ name, payload });
			const reply = replies[name];
			if (reply instanceof Error) throw reply;
			return reply ?? {};
		},
		async dispose() {
			disposed = true;
		},
		emit(event) {
			for (const listener of listeners) listener(event);
		},
		up() {
			for (const listener of statusListeners) listener("up");
		},
	};
	return link;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NextTurnEngine", () => {
	test("folds live events and tells listeners", async () => {
		const link = fakeLink();
		const engine = new NextTurnEngine({ link });
		const seen: number[] = [];
		engine.onChange((fold) => seen.push(fold.sequence));
		await engine.start();
		link.emit({ event: "run.started", sequence: 3, sessionId: "s1" });
		link.emit({
			event: "assistant.delta",
			sequence: 4,
			sessionId: "s1",
			payload: { text: "never folded" },
		});
		expect(seen).toEqual([3]);
		expect(engine.board().sessions[0]).toMatchObject({
			sessionId: "s1",
			state: "running",
		});
	});

	test("seeds from session.list and task.list each time the link comes up, with allWorkspaces on schedules", async () => {
		const link = fakeLink({
			"session.list": {
				sessions: [{ sessionId: "s1", status: "failed", workspaceRoot: "/w" }],
			},
			"task.list": {
				tasks: [
					{
						taskId: "t1",
						status: "pending_approval",
						title: "Ship",
						priority: 0,
					},
				],
			},
		});
		const engine = new NextTurnEngine({ link, scope: { workspaceRoot: "/w" } });
		await engine.start();
		link.up();
		await settle();
		expect(link.sent.map((command) => command.name)).toEqual([
			"session.list",
			"task.list",
			"schedule.upcoming",
			"schedule.list_executions",
		]);
		expect(link.sent[1]?.payload).toEqual({ limit: 200 });
		expect(link.sent[2]?.payload).toEqual({ allWorkspaces: true, limit: 50 });
		expect(link.sent[3]?.payload).toEqual({ allWorkspaces: true, limit: 100 });
		expect(engine.board().sessions[0]?.state).toBe("failed");
		expect(engine.needsYou().map((item) => item.key)).toEqual(["task:t1"]);
	});

	test("a refused task.list still seeds the rest, and says why", async () => {
		const logged: string[] = [];
		const link = fakeLink({
			"session.list": { sessions: [{ sessionId: "s1", status: "running" }] },
			"task.list": new Error("no workspace authority"),
			"schedule.upcoming": { runs: [] },
			"schedule.list_executions": { executions: [] },
		});
		const engine = new NextTurnEngine({
			link,
			log: (message) => logged.push(message),
		});
		await engine.start();
		link.up();
		await settle();
		expect(engine.fold().sessions.s1?.run).toBe("running");
		expect(logged).toEqual(["task.list failed; it fills from live events"]);
		expect(engine.upcoming()).toEqual([]);
	});

	test("notifies once for its own session's new approval, never for another chat's", async () => {
		const link = fakeLink();
		const engine = new NextTurnEngine({
			link,
			sessionId: "mine",
			notify: { enabled: () => true, gate: new NotifyGate(0) },
		});
		await engine.start();
		link.emit({
			event: "approval.requested",
			sequence: 1,
			payload: { approvalId: "a1", sessionId: "other", toolName: "bash" },
		});
		link.emit({
			event: "approval.requested",
			sequence: 2,
			payload: { approvalId: "a2", sessionId: "mine", toolName: "bash" },
		});
		link.emit({
			event: "approval.requested",
			payload: { approvalId: "a2", sessionId: "mine", toolName: "bash" },
		});
		await settle();
		const notifies = link.sent.filter(
			(command) => command.name === "ui.notify",
		);
		expect(notifies).toHaveLength(1);
		expect(notifies[0]?.payload).toMatchObject({
			sessionId: "mine",
			title: "Cline is waiting for your approval",
		});
		expect(
			link.sent.some((command) => command.name === "approval.respond"),
		).toBe(false);
	});

	test("sends nothing while notifications are off", async () => {
		const link = fakeLink();
		const engine = new NextTurnEngine({
			link,
			sessionId: "mine",
			notify: { enabled: () => false, gate: new NotifyGate(0) },
		});
		await engine.start();
		link.emit({
			event: "approval.requested",
			sequence: 1,
			payload: { approvalId: "a", sessionId: "mine" },
		});
		await settle();
		expect(link.sent).toEqual([]);
	});

	test("dispose stops folding and closes the link", async () => {
		const link = fakeLink();
		const engine = new NextTurnEngine({ link });
		await engine.start();
		await engine.dispose();
		link.emit({ event: "run.started", sequence: 1, sessionId: "s" });
		expect(engine.fold().sequence).toBe(0);
		expect(link.disposed()).toBe(true);
	});
});

describe("NotifyGate", () => {
	test("one notification per interval; held items are not sent later", () => {
		let now = 0;
		const gate = new NotifyGate(60, () => now);
		const approval = (id: string) =>
			({
				kind: "approval",
				key: `approval:${id}`,
				approvalId: id,
				sessionId: "s",
				urgency: "critical",
				opens: { kind: "chat", sessionId: "s" },
			}) as const;
		expect(gate.take([approval("a")])?.title).toBe(
			"Cline is waiting for your approval",
		);
		now = 10;
		expect(gate.take([approval("b")])).toBeUndefined();
		now = 100;
		expect(gate.take([approval("b")])).toBeUndefined();
		expect(gate.take([approval("c"), approval("d")])?.body).toBe(
			"2 approvals or questions in this chat. Open it to answer.",
		);
	});
});
