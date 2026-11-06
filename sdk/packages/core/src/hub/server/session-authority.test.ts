import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubReplyEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import type { HubConnectionAuthority } from "./command-transport";
import type { HubWebSocketServer } from "./hub-websocket-server";
import { startHubWebSocketServer } from "./index";
import {
	authorizeSessionWorkspace,
	isPathInsideWorkspace,
} from "./session-authority";

const workspace = "/work/project";
const confined: HubConnectionAuthority = {
	clientId: "browser",
	workspaceContext: { workspaceRoot: workspace, cwd: workspace },
};

describe("isPathInsideWorkspace", () => {
	it("accepts the root and its descendants", () => {
		expect(isPathInsideWorkspace(workspace, workspace)).toBe(true);
		expect(isPathInsideWorkspace(workspace, `${workspace}/src`)).toBe(true);
		expect(isPathInsideWorkspace(workspace, `${workspace}/..project`)).toBe(
			true,
		);
	});

	it("rejects siblings, parents and traversal", () => {
		expect(isPathInsideWorkspace(workspace, "/work")).toBe(false);
		expect(isPathInsideWorkspace(workspace, "/work/project-other")).toBe(false);
		expect(isPathInsideWorkspace(workspace, `${workspace}/../other`)).toBe(
			false,
		);
	});
});

describe("authorizeSessionWorkspace", () => {
	it("trusts in-process callers", () => {
		expect(
			authorizeSessionWorkspace(undefined, { cwd: "/anywhere" }),
		).toBeUndefined();
	});

	it("denies unregistered remote connections", () => {
		expect(
			authorizeSessionWorkspace(null, { workspaceRoot: workspace }),
		).toEqual(expect.any(String));
	});

	it("lets token-authenticated connections use any workspace", () => {
		expect(
			authorizeSessionWorkspace(
				{ ...confined, crossWorkspace: true },
				{ workspaceRoot: "/elsewhere", cwd: "/elsewhere" },
			),
		).toBeUndefined();
	});

	it("allows confined connections inside their workspace", () => {
		expect(
			authorizeSessionWorkspace(confined, {
				workspaceRoot: workspace,
				cwd: `${workspace}/packages/a`,
			}),
		).toBeUndefined();
	});

	it("denies confined connections outside their workspace", () => {
		expect(
			authorizeSessionWorkspace(confined, {
				workspaceRoot: "/elsewhere",
				cwd: "/elsewhere",
			}),
		).toEqual(expect.any(String));
		expect(
			authorizeSessionWorkspace(confined, {
				workspaceRoot: workspace,
				cwd: `${workspace}/../other`,
			}),
		).toEqual(expect.any(String));
	});
});

describe("session.create over an origin-only websocket", () => {
	const servers = new Set<HubWebSocketServer>();

	afterEach(async () => {
		for (const server of servers) await server.close();
		servers.clear();
	});

	async function startConfinedHub(options: { token?: boolean } = {}) {
		const root = await mkdtemp(join(tmpdir(), "hub-session-authority-"));
		const authorizedWorkspace = join(root, "authorized");
		const outside = join(root, "outside");
		await mkdir(authorizedWorkspace);
		await mkdir(outside);
		const startedCwds: unknown[] = [];
		const server = await startHubWebSocketServer({
			owner: createInMemoryHubOwnerContext(`session-authority-${Date.now()}`),
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			workspaceRoot: authorizedWorkspace,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: () => () => undefined,
				dispose: async () => undefined,
				listSessions: async () => [],
				startSession: async (input: { config?: { cwd?: unknown } }) => {
					startedCwds.push(input.config?.cwd);
					throw new Error("stop before the agent runs");
				},
			} as never,
		});
		servers.add(server);
		// Without the token the upgrade is accepted only because of the Origin.
		const socket = options.token
			? new WebSocket(server.url, `cline-hub-auth.${server.authToken}`)
			: new WebSocket(server.url, {
					headers: { Origin: "http://localhost:3000" },
				});
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("error", reject);
		});
		let nextId = 0;
		const command = (
			name: string,
			payload: Record<string, unknown>,
		): Promise<HubReplyEnvelope> => {
			const requestId = `req-${++nextId}`;
			return new Promise((resolve) => {
				const onMessage = (data: WebSocket.RawData) => {
					const frame = JSON.parse(String(data));
					if (
						frame.kind === "reply" &&
						frame.envelope.requestId === requestId
					) {
						socket.off("message", onMessage);
						resolve(frame.envelope);
					}
				};
				socket.on("message", onMessage);
				socket.send(
					JSON.stringify({
						kind: "command",
						envelope: {
							version: "v1",
							requestId,
							command: name,
							clientId: "browser-client",
							payload,
						},
					}),
				);
			});
		};
		return { authorizedWorkspace, outside, startedCwds, socket, command };
	}

	it("rejects session.create before the connection registers", async () => {
		const hub = await startConfinedHub();
		const reply = await hub.command("session.create", {
			cwd: hub.outside,
			runtimeOptions: { mode: "yolo", autoApproveTools: true },
		});
		hub.socket.close();

		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("workspace_not_authorized");
		expect(hub.startedCwds).toEqual([]);
	});

	it("confines a registered origin-only connection to the Hub workspace", async () => {
		const hub = await startConfinedHub();
		const registered = await hub.command("client.register", {
			clientId: "browser-client",
			clientType: "browser",
			displayName: "browser",
			transport: "native",
			actorKind: "client",
			workspaceContext: { workspaceRoot: hub.authorizedWorkspace },
		});
		expect(registered.ok).toBe(true);

		const outside = await hub.command("session.create", {
			cwd: hub.outside,
		});
		const inside = await hub.command("session.create", {
			cwd: hub.authorizedWorkspace,
		});
		hub.socket.close();

		expect(outside.error?.code).toBe("workspace_not_authorized");
		expect(inside.error?.code).not.toBe("workspace_not_authorized");
		expect(hub.startedCwds).toEqual([hub.authorizedWorkspace]);
	});

	it("keeps full session authority for unregistered token connections", async () => {
		const hub = await startConfinedHub({ token: true });
		const reply = await hub.command("session.create", { cwd: hub.outside });
		hub.socket.close();

		expect(reply.error?.code).not.toBe("workspace_not_authorized");
		expect(hub.startedCwds).toEqual([hub.outside]);
	});
});
