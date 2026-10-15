import { describe, expect, test } from "bun:test";
import {
	SEED_EXECUTION_LIMIT,
	SEED_SESSION_LIMIT,
	SEED_TASK_LIMIT,
	SEED_UPCOMING_LIMIT,
} from "../config";
import { ASK_QUESTION_CAPABILITY, emptyFold, foldEvent } from "../hub/fold";
import type { HubEvent, HubLinkStatus } from "../hub/link";
import { type EngineLink, NextTurnEngine } from "./engine";
import { NotifyGate, waitingOn } from "./notify";

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
		down(): void;
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
		down() {
			for (const listener of statusListeners) listener("down");
		},
	};
	return link;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function hoursFromNow(hours: number): string {
	return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Holds the answers to `name` commands, each read as the hub stood when it was sent, until the returned release is called. */
function holdCommands(link: ReturnType<typeof fakeLink>, name: string) {
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const reply = link.command;
	link.command = async (command, payload) => {
		const answer = reply(command, payload);
		if (command === name) await held;
		return answer;
	};
	return release;
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

	test("seeds from session.list and task.list when the link comes up, with allWorkspaces on schedules", async () => {
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
			"schedule.list_executions",
			"schedule.upcoming",
			"schedule.list",
		]);
		expect(link.sent.map((command) => command.payload)).toEqual([
			{ rootOnly: true, limit: SEED_SESSION_LIMIT },
			{ limit: SEED_TASK_LIMIT },
			{ allWorkspaces: true, limit: SEED_EXECUTION_LIMIT },
			{ allWorkspaces: true, limit: SEED_UPCOMING_LIMIT },
			{ allWorkspaces: true, enabled: true, limit: SEED_UPCOMING_LIMIT },
		]);
		expect(engine.board().sessions[0]?.state).toBe("failed");
		expect(engine.needsYou().map((item) => item.key)).toEqual(["task:t1"]);
	});

	test("after a reconnect, the seed replaces sessions and tasks no event touched since the drop", async () => {
		const replies: Record<string, Record<string, unknown>> = {};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		link.emit({ event: "run.started", sequence: 1, sessionId: "s1" });
		link.emit({
			event: "approval.requested",
			sequence: 2,
			payload: { approvalId: "a1", sessionId: "s1", toolName: "bash" },
		});
		link.emit({ event: "run.started", sequence: 3, sessionId: "s2" });
		link.emit({
			event: "approval.requested",
			sequence: 4,
			payload: { approvalId: "a2", sessionId: "s2", toolName: "bash" },
		});
		link.emit({ event: "run.started", sequence: 5, sessionId: "s3" });
		link.emit({
			event: "capability.requested",
			sequence: 6,
			sessionId: "s3",
			payload: {
				requestId: "q1",
				capabilityName: "tool_executor.askQuestion",
			},
		});
		link.emit({
			event: "task.created",
			sequence: 7,
			payload: { task: { taskId: "t1", status: "pending_approval" } },
		});
		link.down();
		replies["session.list"] = {
			sessions: [
				{ sessionId: "s1", status: "completed" },
				{ sessionId: "s2", status: "completed" },
				{ sessionId: "s3", status: "running" },
			],
		};
		replies["task.list"] = { tasks: [{ taskId: "t1", status: "completed" }] };
		link.up();
		link.emit({
			event: "approval.requested",
			payload: { approvalId: "a2", sessionId: "s2", toolName: "bash" },
		});
		await settle();
		const { sessions } = engine.fold();
		expect(sessions.s1).toMatchObject({
			run: "completed",
			pendingApprovals: {},
		});
		expect(sessions.s2?.run).toBe("running");
		expect(Object.keys(sessions.s2?.pendingApprovals ?? {})).toEqual(["a2"]);
		expect(Object.keys(sessions.s3?.pendingQuestions ?? {})).toEqual(["q1"]);
		expect(engine.fold().tasks.t1?.status).toBe("completed");
		expect(engine.needsYou().map((item) => item.key)).toEqual([
			"approval:a2",
			"question:q1",
		]);
	});

	test("after a reconnect, an approval the hub did not re-issue goes, even from a session that saw other events", async () => {
		const replies: Record<string, Record<string, unknown>> = {};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		link.emit({ event: "run.started", sequence: 1, sessionId: "s1" });
		for (const [sequence, approvalId] of [
			[2, "a1"],
			[3, "a2"],
		] as const) {
			link.emit({
				event: "approval.requested",
				sequence,
				payload: { approvalId, sessionId: "s1", toolName: "bash" },
			});
		}
		link.down();
		replies["session.list"] = {
			sessions: [{ sessionId: "s1", status: "running" }],
		};
		link.up();
		link.emit({
			event: "approval.requested",
			payload: { approvalId: "a2", sessionId: "s1", toolName: "bash" },
		});
		await settle();
		expect(
			Object.keys(engine.fold().sessions.s1?.pendingApprovals ?? {}),
		).toEqual(["a2"]);
		expect(engine.needsYou().map((item) => item.key)).toEqual(["approval:a2"]);
		link.emit({ event: "approval.resolved", payload: { approvalId: "a2" } });
		expect(engine.fold().sessions.s1?.pendingApprovals).toEqual({});
	});

	test("after a reconnect, the hub's latest execution replaces an untouched one, and a deleted task goes", async () => {
		const replies: Record<string, Record<string, unknown>> = {
			"task.list": {
				tasks: [
					{ taskId: "t1", status: "pending_approval" },
					{ taskId: "t2", status: "pending_approval" },
				],
			},
			"schedule.list_executions": {
				executions: [
					{ scheduleId: "x", executionId: "e1", status: "failed", endedAt: 1 },
				],
			},
		};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		expect(engine.fold().schedules.x?.executionId).toBe("e1");
		link.down();
		replies["task.list"] = {
			tasks: [{ taskId: "t2", status: "pending_approval" }],
		};
		replies["schedule.list_executions"] = {
			executions: [
				{
					scheduleId: "x",
					executionId: "e2",
					status: "completed",
					endedAt: 2,
				},
			],
		};
		link.up();
		await settle();
		expect(engine.fold().schedules.x).toMatchObject({
			executionId: "e2",
			status: "completed",
		});
		expect(Object.keys(engine.fold().tasks)).toEqual(["t2"]);
	});

	test("a seed answered after the link dropped again is discarded", async () => {
		let answer: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		const link = fakeLink({
			"session.list": { sessions: [{ sessionId: "s1", status: "completed" }] },
		});
		const reply = link.command;
		link.command = async (name, payload) => {
			await answered;
			return reply(name, payload);
		};
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		link.down();
		answer();
		await settle();
		expect(engine.fold().sessions.s1).toBeUndefined();
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

	test("a finished scheduled run asks for the upcoming runs again; a schedule the hub leaves out goes only once its time has passed", async () => {
		const weekly = {
			scheduleId: "weekly",
			name: "Weekly",
			nextRunAt: hoursFromNow(96),
		};
		const replies: Record<string, Record<string, unknown>> = {
			"schedule.upcoming": {
				runs: [
					{
						scheduleId: "nightly",
						name: "Nightly",
						nextRunAt: hoursFromNow(-1),
					},
					{ scheduleId: "once", name: "Once", nextRunAt: hoursFromNow(-2) },
					weekly,
				],
			},
		};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		expect(engine.upcoming()).toHaveLength(3);
		const tomorrow = hoursFromNow(23);
		replies["schedule.upcoming"] = {
			runs: [{ scheduleId: "nightly", name: "Nightly", nextRunAt: tomorrow }],
		};
		link.emit({
			event: "schedule.execution_completed",
			sequence: 1,
			payload: {
				scheduleId: "nightly",
				executionId: "e1",
				status: "completed",
			},
		});
		await settle();
		expect(engine.upcoming()).toEqual([
			{ scheduleId: "nightly", name: "Nightly", nextRunAt: tomorrow },
			weekly,
		]);
	});

	test("a slow seed never brings back an upcoming time a newer read replaced", async () => {
		const replies: Record<string, Record<string, unknown>> = {
			"schedule.upcoming": {
				runs: [{ scheduleId: "nightly", nextRunAt: hoursFromNow(1) }],
			},
		};
		const link = fakeLink(replies);
		const releaseTasks = holdCommands(link, "task.list");
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		const moved = hoursFromNow(25);
		replies["schedule.upcoming"] = {
			runs: [{ scheduleId: "nightly", nextRunAt: moved }],
		};
		link.emit({
			event: "schedule.updated",
			sequence: 1,
			payload: { schedule: { scheduleId: "nightly", enabled: true } },
		});
		await settle();
		expect(engine.upcoming().map((run) => run.nextRunAt)).toEqual([moved]);
		releaseTasks();
		await settle();
		expect(engine.upcoming().map((run) => run.nextRunAt)).toEqual([moved]);
	});

	test("a disabled schedule leaves Upcoming even when an answer asked before the change arrives after it", async () => {
		const weekly = { scheduleId: "weekly", nextRunAt: hoursFromNow(96) };
		const replies: Record<string, Record<string, unknown>> = {
			"schedule.upcoming": {
				runs: [{ scheduleId: "nightly", nextRunAt: hoursFromNow(1) }, weekly],
			},
			"schedule.list": {
				schedules: [{ scheduleId: "nightly" }, { scheduleId: "weekly" }],
			},
		};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		const releaseUpcoming = holdCommands(link, "schedule.upcoming");
		link.emit({
			event: "schedule.execution_completed",
			sequence: 1,
			payload: { scheduleId: "weekly", executionId: "e1", status: "completed" },
		});
		replies["schedule.upcoming"] = { runs: [weekly] };
		replies["schedule.list"] = { schedules: [{ scheduleId: "weekly" }] };
		link.emit({
			event: "schedule.updated",
			sequence: 2,
			payload: { schedule: { scheduleId: "nightly", enabled: false } },
		});
		expect(engine.upcoming().map((run) => run.scheduleId)).toEqual(["weekly"]);
		releaseUpcoming();
		await settle();
		expect(engine.upcoming().map((run) => run.scheduleId)).toEqual(["weekly"]);
	});

	test("a schedule deleted by a command whose event names no schedule leaves Upcoming", async () => {
		const weekly = { scheduleId: "weekly", nextRunAt: hoursFromNow(96) };
		const replies: Record<string, Record<string, unknown>> = {
			"schedule.upcoming": {
				runs: [{ scheduleId: "nightly", nextRunAt: hoursFromNow(1) }, weekly],
			},
			"schedule.list": {
				schedules: [{ scheduleId: "nightly" }, { scheduleId: "weekly" }],
			},
		};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		replies["schedule.upcoming"] = { runs: [weekly] };
		replies["schedule.list"] = { schedules: [{ scheduleId: "weekly" }] };
		link.emit({
			event: "schedule.deleted",
			sequence: 1,
			payload: { deleted: true },
		});
		await settle();
		expect(engine.upcoming().map((run) => run.scheduleId)).toEqual(["weekly"]);
	});

	test("a schedule disabled while the link was down leaves Upcoming when it comes back up", async () => {
		const weekly = { scheduleId: "weekly", nextRunAt: hoursFromNow(96) };
		const replies: Record<string, Record<string, unknown>> = {
			"schedule.upcoming": {
				runs: [{ scheduleId: "nightly", nextRunAt: hoursFromNow(1) }, weekly],
			},
			"schedule.list": {
				schedules: [{ scheduleId: "nightly" }, { scheduleId: "weekly" }],
			},
		};
		const link = fakeLink(replies);
		const engine = new NextTurnEngine({ link });
		await engine.start();
		link.up();
		await settle();
		link.down();
		replies["schedule.upcoming"] = { runs: [weekly] };
		replies["schedule.list"] = { schedules: [{ scheduleId: "weekly" }] };
		link.up();
		await settle();
		expect(engine.upcoming().map((run) => run.scheduleId)).toEqual(["weekly"]);
	});

	test("the upcoming runs read on connect stay when the read after a change fails", async () => {
		const logged: string[] = [];
		const replies: Record<string, Record<string, unknown> | Error> = {
			"schedule.upcoming": {
				runs: [{ scheduleId: "weekly", nextRunAt: hoursFromNow(96) }],
			},
		};
		const link = fakeLink(replies);
		const releaseTasks = holdCommands(link, "task.list");
		const engine = new NextTurnEngine({
			link,
			log: (message) => logged.push(message),
		});
		await engine.start();
		link.up();
		replies["schedule.upcoming"] = new Error("timed out");
		link.emit({
			event: "schedule.execution_completed",
			sequence: 1,
			payload: { scheduleId: "other", executionId: "e1" },
		});
		await settle();
		releaseTasks();
		await settle();
		expect(engine.upcoming().map((run) => run.scheduleId)).toEqual(["weekly"]);
		expect(logged).toEqual(["the upcoming runs could not be read; they stay"]);
	});

	test("notifies once for its own session's new approval, never for another chat's", async () => {
		const link = fakeLink();
		const engine = new NextTurnEngine({
			link,
			sessionId: "mine",
			notify: new NotifyGate({ enabled: () => true, minIntervalMs: 0 }),
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
			notify: new NotifyGate({ enabled: () => false, minIntervalMs: 0 }),
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
	const approval = (id: string) =>
		({ key: `approval:${id}`, kind: "approval", sessionId: "s" }) as const;

	test("one notification per interval; held items are not sent later", () => {
		let now = 0;
		const gate = new NotifyGate({
			enabled: () => true,
			minIntervalMs: 60,
			now: () => now,
		});
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

	test("an item offered while notifications are off is not sent once they are on", () => {
		let enabled = false;
		const gate = new NotifyGate({ enabled: () => enabled, minIntervalMs: 0 });
		expect(gate.take([approval("a")])).toBeUndefined();
		enabled = true;
		expect(gate.take([approval("a")])).toBeUndefined();
		expect(gate.take([approval("a"), approval("b")])?.title).toBe(
			"Cline is waiting for your approval",
		);
	});

	test("a session's approvals and questions are what it waits on", () => {
		const events: HubEvent[] = [
			{
				event: "approval.requested",
				payload: { approvalId: "a1", sessionId: "s", toolName: "bash" },
			},
			{
				event: "capability.requested",
				sessionId: "s",
				payload: { requestId: "q1", capabilityName: ASK_QUESTION_CAPABILITY },
			},
		];
		const session = events.reduce(foldEvent, emptyFold()).sessions.s;
		if (!session) throw new Error("the session was not folded");
		expect(waitingOn(session)).toEqual([
			{
				key: "approval:a1",
				kind: "approval",
				sessionId: "s",
				toolName: "bash",
			},
			{ key: "question:q1", kind: "question", sessionId: "s" },
		]);
		const gate = new NotifyGate({ enabled: () => true, minIntervalMs: 0 });
		expect(gate.take(waitingOn(session).slice(1))).toMatchObject({
			title: "Cline asked you a question",
			sessionId: "s",
		});
	});
});
