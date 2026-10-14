import { describe, expect, test } from "bun:test";
import {
	createInMemoryHubOwnerContext,
	createLocalHubScheduleRuntimeHandlers,
	startHubWebSocketServer,
} from "@cline/core/hub";
import { setClineDir } from "@cline/shared/storage";
import { useTempDirs } from "../test-support";
import {
	type HubClientPort,
	HubCommandFailed,
	type HubEvent,
	HubLink,
	type HubLinkDeps,
	HubLinkRefusal,
	type HubLinkStatus,
	HubLinkUnavailable,
	nodeHubLinkDeps,
} from "./link";

const tempDir = useTempDirs("next-turn-link-", { restoreClineDir: true });

type FakeClient = HubClientPort & {
	emit(event: HubEvent): void;
	setConnected(next: boolean): void;
	disposed: boolean;
	commands: string[];
};

function fakeClient(
	options: { failConnect?: boolean; failWith?: HubCommandFailed } = {},
): FakeClient {
	const listeners = new Set<(event: HubEvent) => void>();
	const statusListeners = new Set<(connected: boolean) => void>();
	let connected = false;
	const client: FakeClient = {
		disposed: false,
		commands: [],
		async connect() {
			if (options.failConnect) throw new Error("refused");
			connected = true;
		},
		isConnected: () => connected,
		onStatus(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async command(name) {
			client.commands.push(name);
			if (options.failWith) throw options.failWith;
			return { name };
		},
		async dispose() {
			client.disposed = true;
		},
		emit(event) {
			for (const listener of listeners) listener(event);
		},
		setConnected(next) {
			connected = next;
			for (const listener of statusListeners) listener(next);
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
		resolveEndpoint: async () => (url ? { url } : undefined),
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

function nextStatus(link: HubLink, status: HubLinkStatus): Promise<void> {
	return new Promise((resolve) => {
		const stop = link.onStatus((next) => {
			if (next !== status) return;
			stop();
			resolve();
		});
	});
}

describe("HubLink", () => {
	test("no running hub: off, hub-backed sources absent, nothing started", async () => {
		const d = deps(undefined, []);
		const link = new HubLink(d);
		await link.start();
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
		expect(link.availability()).toBe("present");
		expect(statuses.at(-1)).toBe("up");
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
					failWith: new HubCommandFailed(
						"task.list",
						"task_command_failed",
						"no workspace",
					),
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

	test("a drop at an unchanged endpoint keeps the client, and the link is up again once it reconnects", async () => {
		const client = fakeClient();
		const d = deps("ws://hub", [client]);
		const link = new HubLink({
			...d,
			sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
		});
		const statuses: HubLinkStatus[] = [];
		link.onStatus((status) => statuses.push(status));
		await link.start();
		client.setConnected(false);
		expect(link.availability()).toBe("unknown");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(d.created).toEqual([client]);
		client.setConnected(true);
		expect(link.availability()).toBe("present");
		expect(statuses).toEqual(["connecting", "up", "down", "up"]);
		expect(client.disposed).toBe(false);
		await link.dispose();
	});

	test("a drop with a rotated token reconnects through a new client, which carries every listener", async () => {
		let currentToken = "tok-1";
		const c1 = fakeClient();
		const c2 = fakeClient();
		const usedTokens: Array<string | undefined> = [];
		const link = new HubLink({
			resolveEndpoint: async () => ({
				url: "ws://hub",
				authToken: currentToken,
			}),
			createClient(endpoint) {
				usedTokens.push(endpoint.authToken);
				return usedTokens.length === 1 ? c1 : c2;
			},
			sleep: async () => {},
		});
		const statuses: HubLinkStatus[] = [];
		link.onStatus((status) => statuses.push(status));
		const seen: string[] = [];
		link.subscribe(new Set(["run.started"]), (event) =>
			seen.push(event.sessionId ?? ""),
		);
		await link.start();
		expect(usedTokens).toEqual(["tok-1"]);

		currentToken = "tok-2";
		const up = nextStatus(link, "up");
		c1.setConnected(false);
		await up;
		expect(usedTokens).toEqual(["tok-1", "tok-2"]);
		expect(statuses).toEqual(["connecting", "up", "down", "up"]);
		expect(c1.disposed).toBe(true);
		c1.emit({ event: "run.started", sessionId: "old" });
		c2.emit({ event: "run.started", sessionId: "new" });
		expect(seen).toEqual(["new"]);
	});
});

describe("the real link against a @cline/core hub", () => {
	test("a reply resolves to its payload, and a hub error rejects as HubCommandFailed with its code", async () => {
		const workspaceRoot = tempDir("workspace-");
		setClineDir(tempDir("cline-"));
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			workspaceRoot,
			owner: createInMemoryHubOwnerContext("next-turn-link-test"),
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const link = new HubLink(
			{
				...nodeHubLinkDeps(),
				resolveEndpoint: async () => ({
					url: server.url,
					authToken: server.authToken,
				}),
			},
			{ workspaceRoot, cwd: workspaceRoot },
		);
		try {
			await link.start();
			expect(link.availability()).toBe("present");
			expect(await link.command("task.list", {})).toEqual({ tasks: [] });
			const failure = await link
				.command("task.get", { taskId: "task_missing" })
				.catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(HubCommandFailed);
			expect((failure as HubCommandFailed).code).toBe("task_command_failed");
		} finally {
			await link.dispose().catch(() => {});
			await Promise.race([server.close().catch(() => {}), Bun.sleep(1_000)]);
		}
	}, 15_000);
});
