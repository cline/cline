import { describe, expect, test } from "bun:test";
import {
	type HubClientPort,
	HubCommandFailed,
	type HubEvent,
	HubLink,
	type HubLinkDeps,
	HubLinkRefusal,
	type HubLinkStatus,
	HubLinkUnavailable,
	type HubReply,
} from "./link";

type FakeClient = HubClientPort & {
	emit(event: HubEvent): void;
	disposed: boolean;
	commands: string[];
};

function fakeClient(
	options: { failConnect?: boolean; reply?: HubReply } = {},
): FakeClient {
	const listeners = new Set<(event: HubEvent) => void>();
	const client: FakeClient = {
		disposed: false,
		commands: [],
		async connect() {
			if (options.failConnect) throw new Error("refused");
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async command(name) {
			client.commands.push(name);
			return options.reply ?? { ok: true, payload: { name } };
		},
		async dispose() {
			client.disposed = true;
		},
		emit(event) {
			for (const listener of listeners) listener(event);
		},
	};
	return client;
}

function deps(
	url: string | undefined,
	clients: FakeClient[],
): HubLinkDeps & { sleeps: number[]; created: FakeClient[] } {
	const created: FakeClient[] = [];
	const sleeps: number[] = [];
	return {
		created,
		sleeps,
		resolveUrl: async () => url,
		createClient() {
			const client = clients.shift() ?? fakeClient();
			created.push(client);
			return client;
		},
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	};
}

describe("HubLink", () => {
	test("no running hub: off, hub-backed sources absent, nothing started", async () => {
		const d = deps(undefined, []);
		const link = new HubLink(d);
		await link.start();
		expect(link.status()).toBe("off");
		expect(link.availability()).toBe("absent");
		expect(d.created).toHaveLength(0);
	});

	test("connects, fans out only the named events, and reports present", async () => {
		const client = fakeClient();
		const link = new HubLink(deps("ws://hub", [client]));
		const statuses: HubLinkStatus[] = [];
		link.onStatus((status) => statuses.push(status));
		const seen: string[] = [];
		link.subscribe(new Set(["run.completed"]), (event) =>
			seen.push(event.event),
		);
		await link.start();
		client.emit({ event: "run.completed", sessionId: "s1" });
		client.emit({
			event: "assistant.delta",
			sessionId: "s1",
			payload: { text: "secret" },
		});
		expect(seen).toEqual(["run.completed"]);
		expect(link.availability()).toBe("present");
		expect(statuses).toEqual(["connecting", "up"]);
	});

	test("a throwing listener does not starve the others", async () => {
		const client = fakeClient();
		const link = new HubLink(deps("ws://hub", [client]));
		const seen: string[] = [];
		link.subscribe(new Set(["task.updated"]), () => {
			throw new Error("boom");
		});
		link.subscribe(new Set(["task.updated"]), (event) =>
			seen.push(event.event),
		);
		await link.start();
		client.emit({ event: "task.updated" });
		expect(seen).toEqual(["task.updated"]);
	});

	test("retries with growing backoff while a hub exists but refuses, unknown meanwhile", async () => {
		const d = deps("ws://hub", [
			fakeClient({ failConnect: true }),
			fakeClient({ failConnect: true }),
			fakeClient(),
		]);
		const link = new HubLink(d);
		const statuses: HubLinkStatus[] = [];
		link.onStatus((status) => statuses.push(status));
		await link.start();
		expect(link.status()).toBe("up");
		expect(d.sleeps).toHaveLength(2);
		expect(d.sleeps[1]).toBeGreaterThan(d.sleeps[0] ?? 0);
		expect(statuses).toContain("down");
		expect(d.created.slice(0, 2).every((client) => client.disposed)).toBe(true);
	});

	test("never sends approval or capability replies, even when up", async () => {
		const client = fakeClient();
		const link = new HubLink(deps("ws://hub", [client]));
		await link.start();
		await expect(
			link.command("approval.respond", { approvalId: "a", approved: true }),
		).rejects.toBeInstanceOf(HubLinkRefusal);
		await expect(link.command("capability.respond", {})).rejects.toBeInstanceOf(
			HubLinkRefusal,
		);
		expect(client.commands).toEqual([]);
	});

	test("commands need the link up, and a failed reply throws with its code", async () => {
		const idle = new HubLink(deps("ws://hub", []));
		await expect(idle.command("task.list")).rejects.toBeInstanceOf(
			HubLinkUnavailable,
		);
		const link = new HubLink(
			deps("ws://hub", [
				fakeClient({
					reply: {
						ok: false,
						error: { code: "task_command_failed", message: "no workspace" },
					},
				}),
			]),
		);
		await link.start();
		const failure = await link
			.command("task.list")
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(HubCommandFailed);
		expect((failure as HubCommandFailed).code).toBe("task_command_failed");
	});

	test("dispose closes the client and stops delivery", async () => {
		const client = fakeClient();
		const link = new HubLink(deps("ws://hub", [client]));
		const seen: string[] = [];
		link.subscribe(new Set(["run.started"]), (event) => seen.push(event.event));
		await link.start();
		await link.dispose();
		client.emit({ event: "run.started" });
		expect(seen).toEqual([]);
		expect(client.disposed).toBe(true);
		expect(link.availability()).toBe("absent");
	});

	test("reports down on disconnect, reconnects with a rotated token, and reseeds on up; command-only mode never subscribes", async () => {
		let currentToken = "tok-1";
		const statusListeners1 = new Set<(s: "up" | "down") => void>();
		const c1: FakeClient = {
			...fakeClient(),
			onStatus(listener) {
				statusListeners1.add(listener);
				return () => statusListeners1.delete(listener);
			},
		};
		const c2 = fakeClient();
		const usedTokens: Array<string | undefined> = [];
		let subscribedCount = 0;

		const linkDeps: HubLinkDeps = {
			resolveUrl: async () => "ws://hub",
			resolveEndpoint: async () => ({
				url: "ws://hub",
				authToken: currentToken,
			}),
			createClient(_url, _scope, authToken) {
				usedTokens.push(authToken);
				const next = usedTokens.length === 1 ? c1 : c2;
				const origSub = next.subscribe.bind(next);
				next.subscribe = (listener) => {
					subscribedCount += 1;
					return origSub(listener);
				};
				return next;
			},
			sleep: async () => {},
		};

		const events: Array<{ status: HubLinkStatus; resumed?: boolean }> = [];
		const link = new HubLink(linkDeps);
		link.onStatus((status, meta) =>
			events.push({
				status,
				...(meta?.resumed !== undefined ? { resumed: meta.resumed } : {}),
			}),
		);
		await link.start();
		expect(usedTokens).toEqual(["tok-1"]);
		expect(subscribedCount).toBe(1);

		currentToken = "tok-2";
		for (const listener of statusListeners1) listener("down");
		await new Promise((r) => setTimeout(r, 20));
		expect(usedTokens).toEqual(["tok-1", "tok-2"]);
		expect(events.map((e) => e.status)).toEqual([
			"connecting",
			"up",
			"down",
			"up",
		]);
		expect(events.at(-1)?.resumed).toBe(true);

		let cmdOnlySubscribed = false;
		const cmdOnly = new HubLink(
			{
				...linkDeps,
				createClient() {
					const fc = fakeClient();
					fc.subscribe = () => {
						cmdOnlySubscribed = true;
						return () => {};
					};
					return fc;
				},
			},
			{},
			{ subscribe: false },
		);
		await cmdOnly.start();
		expect(cmdOnlySubscribed).toBe(false);
	});
});
