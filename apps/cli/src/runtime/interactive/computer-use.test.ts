import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	createInteractiveComputerUse,
	type InteractiveComputerUse,
} from "./computer-use";

const toolContext: AgentToolContext = {
	agentId: "driver-agent",
	conversationId: "driver-conversation",
	iteration: 1,
};

/** JSON-L backend that tracks requests and sockets for host lifecycle assertions. */
async function startStubBackend(
	displayError?: string,
	publishResponses: Array<string | null> = [],
) {
	const sockets = new Set<Socket>();
	const requests: Array<Record<string, unknown>> = [];
	let connections = 0;
	let publishCount = 0;
	const server = createServer((socket: Socket) => {
		connections++;
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.trim().length > 0) {
					const request = JSON.parse(line) as Record<string, unknown> & {
						id: number;
					};
					requests.push(request);
					const publishResponse =
						request.action === "publish_event"
							? publishResponses[publishCount++]
							: undefined;
					// null keeps a publish pending until the host aborts and closes
					// its connection. Other requests still use the real TCP path.
					if (publishResponse === null) {
						newlineIndex = buffer.indexOf("\n");
						continue;
					}
					const error =
						request.action === "get_display_info"
							? displayError
							: publishResponse;
					socket.write(
						`${JSON.stringify({
							id: request.id,
							ok: !error,
							...(error
								? { error }
								: { display: { widthPx: 1920, heightPx: 1080 } }),
						})}\n`,
					);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		port: (server.address() as AddressInfo).port,
		requests,
		get connections() {
			return connections;
		},
		get activeConnections() {
			return sockets.size;
		},
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		},
	};
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo;
			probe.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

function portAcceptsConnections(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new Socket();
		const settle = (accepted: boolean) => {
			socket.destroy();
			resolve(accepted);
		};
		socket.setTimeout(1_000, () => settle(false));
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
		socket.connect(port, "127.0.0.1");
	});
}

const fakeBackendPath = fileURLToPath(
	new URL(
		"../../../../../sdk/packages/core/src/extensions/computer-use/test-fixtures/fake-backend.mjs",
		import.meta.url,
	),
);

function fixtureLaunchCommand(port: number, pidFile?: string): string {
	return `${JSON.stringify(process.execPath)} ${JSON.stringify(fakeBackendPath)} ${port} 30000 0 ${JSON.stringify(pidFile ?? "")}`;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		providerId: "cline",
		modelId: "driver-model",
		apiKey: "",
		cwd: process.cwd(),
		workspaceRoot: process.cwd(),
		systemPrompt: "system",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		verbose: false,
		outputMode: "text",
		sandbox: false,
		defaultToolAutoApprove: true,
		toolPolicies: { "*": { autoApprove: true } },
		...overrides,
	};
}

describe("createInteractiveComputerUse", () => {
	let backend: Awaited<ReturnType<typeof startStubBackend>> | undefined;
	let runtime: InteractiveComputerUse | undefined;
	let fixtureDirectory: string | undefined;

	const tool = (name: string) => {
		const found = runtime?.driverTools.find((tool) => tool.name === name);
		if (!found) throw new Error(`missing tool ${name}`);
		return found;
	};

	afterEach(async () => {
		try {
			await runtime?.dispose();
		} finally {
			runtime = undefined;
			try {
				await backend?.close();
			} finally {
				backend = undefined;
				if (fixtureDirectory) {
					rmSync(fixtureDirectory, { recursive: true, force: true });
					fixtureDirectory = undefined;
				}
				vi.unstubAllEnvs();
			}
		}
	});

	it("returns undefined when computer use is not enabled by env", async () => {
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: {},
		});
		expect(runtime).toBeUndefined();
	});

	it("reads the process environment when env is omitted", async () => {
		backend = await startStubBackend();
		vi.stubEnv("CLINE_COMPUTER_USE_PORT", String(backend.port));
		vi.stubEnv("CLINE_COMPUTER_USE_HOST", "127.0.0.1");
		vi.stubEnv("CLINE_COMPUTER_USE_BACKEND_COMMAND", "");

		runtime = await createInteractiveComputerUse({ config: makeConfig() });
		expect(runtime?.driverTools.map((tool) => tool.name)).toEqual(["computer"]);
		await expect(
			tool("computer").execute({ action: "screenshot" }, toolContext),
		).resolves.toBe('Action "screenshot" completed.');
	});

	it("publishes the computer tool on first run and recovers before the next action", async () => {
		const port = await freePort();
		fixtureDirectory = mkdtempSync(join(tmpdir(), "cli-computer-use-"));
		const pidFile = join(fixtureDirectory, "backend.pid");
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: {
				CLINE_COMPUTER_USE_PORT: String(port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: fixtureLaunchCommand(port, pidFile),
			},
		});

		expect(runtime?.driverTools.map((tool) => tool.name)).toEqual([
			"computer",
			"computer_restart_backend",
		]);
		const originalPid = Number(readFileSync(pidFile, "utf8"));
		process.kill(originalPid, "SIGKILL");
		await vi.waitFor(async () => {
			expect(await portAcceptsConnections(port)).toBe(false);
		});
		await expect(
			tool("computer").execute({ action: "screenshot" }, toolContext),
		).resolves.toBe('Action "screenshot" completed.');
		expect(Number(readFileSync(pidFile, "utf8"))).not.toBe(originalPid);

		await runtime?.dispose();
		runtime = undefined;
		await vi.waitFor(async () => {
			expect(await portAcceptsConnections(port)).toBe(false);
		});
	}, 15_000);

	it.each([
		"anthropic",
		"openrouter",
		"cline",
	])("registers raw computer use independently of the %s provider", async (providerId) => {
		backend = await startStubBackend();
		runtime = await createInteractiveComputerUse({
			config: makeConfig({ providerId, apiKey: "driver-credential" }),
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
		});

		expect(runtime?.driverTools.map((tool) => tool.name)).toEqual(["computer"]);
		await expect(
			tool("computer").execute({ action: "screenshot" }, toolContext),
		).resolves.toBe('Action "screenshot" completed.');
	});

	it.each([
		undefined,
		"",
		" \t",
	])("excludes backend restart when the launch command is %s", async (command) => {
		backend = await startStubBackend();
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: {
				CLINE_COMPUTER_USE_PORT: String(backend.port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: command,
			},
		});

		expect(runtime?.driverTools.map((tool) => tool.name)).toEqual(["computer"]);
	});

	it("adds restart for a configured command without taking ownership of a running backend", async () => {
		backend = await startStubBackend();
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: {
				CLINE_COMPUTER_USE_PORT: String(backend.port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: "exit 9",
			},
		});

		expect(runtime?.driverTools.map((tool) => tool.name)).toEqual([
			"computer",
			"computer_restart_backend",
		]);
		await expect(
			tool("computer").execute({ action: "screenshot" }, toolContext),
		).resolves.toBe('Action "screenshot" completed.');
		expect(backend.connections).toBe(1);
		await runtime?.dispose();
		runtime = undefined;
		await vi.waitFor(() => expect(backend?.activeConnections).toBe(0));
		expect(await portAcceptsConnections(backend.port)).toBe(true);
	});

	it("force-restarts the actual backend and allows the next screenshot", async () => {
		const port = await freePort();
		fixtureDirectory = mkdtempSync(join(tmpdir(), "cli-computer-use-"));
		const pidFile = join(fixtureDirectory, "backend.pid");
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: {
				CLINE_COMPUTER_USE_PORT: String(port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: fixtureLaunchCommand(port, pidFile),
			},
		});

		const originalPid = Number(readFileSync(pidFile, "utf8"));
		await expect(
			tool("computer_restart_backend").execute({}, toolContext),
		).resolves.toMatchObject({ status: "started" });
		expect(Number(readFileSync(pidFile, "utf8"))).not.toBe(originalPid);
		await expect(
			tool("computer").execute({ action: "screenshot" }, toolContext),
		).resolves.toBe('Action "screenshot" completed.');
		await runtime?.dispose();
		runtime = undefined;
		await vi.waitFor(async () => {
			expect(await portAcceptsConnections(port)).toBe(false);
		});
	}, 15_000);

	it("publishes and flushes the driver transcript on the raw tool's connection", async () => {
		backend = await startStubBackend();
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
		});
		await tool("computer").execute({ action: "screenshot" }, toolContext);
		for (const text of ["Using the computer directly", "Desktop inspected"]) {
			await runtime?.driverRecordingHooks.onEvent?.({
				type: "message-added",
				snapshot: { agentId: "driver-agent" } as never,
				message: {
					id: text,
					role: "assistant",
					content: [{ type: "text", text }],
					createdAt: 0,
				},
			});
		}

		await runtime?.dispose();
		runtime = undefined;
		expect(backend.requests.map((request) => request.action)).toEqual([
			"get_display_info",
			"screenshot",
			"publish_event",
			"publish_event",
		]);
		expect(backend.requests.slice(2)).toMatchObject([
			{
				kind: "transcript.message_committed",
				payload: {
					clientSequence: 1,
					source: { kind: "driver" },
					payload: { role: "assistant", text: "Using the computer directly" },
				},
			},
			{
				kind: "transcript.message_committed",
				payload: {
					clientSequence: 2,
					source: { kind: "driver" },
					payload: { role: "assistant", text: "Desktop inspected" },
				},
			},
		]);
		expect(backend.connections).toBe(1);
		await vi.waitFor(() => expect(backend?.activeConnections).toBe(0));
	});

	it("stops degraded journal publishing before disposal closes the shared connection", async () => {
		backend = await startStubBackend(undefined, [
			"journal rejected event",
			null,
		]);
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
		});
		for (const text of ["First queued message", "Second", "Third"]) {
			await runtime?.driverRecordingHooks.onEvent?.({
				type: "message-added",
				snapshot: { agentId: "driver-agent" } as never,
				message: {
					id: text,
					role: "assistant",
					content: [{ type: "text", text }],
					createdAt: 0,
				},
			});
		}

		const publishes = () =>
			backend?.requests.filter((request) => request.action === "publish_event");
		// The first rejection has degraded flush; the second publish is now
		// waiting on TCP and the third is queued. Disposal must stop the drain
		// before closing the client, rather than reconnecting for the third send.
		await vi.waitFor(() => expect(publishes()).toHaveLength(2));
		expect(backend.connections).toBe(1);
		expect(backend.activeConnections).toBe(1);
		const connectionCount = backend.connections;

		await runtime?.dispose();
		runtime = undefined;
		await vi.waitFor(() => expect(backend?.activeConnections).toBe(0));
		// Allow TCP close/reconnect callbacks to run before checking that
		// disposal is a stop barrier, rather than only a flush status result.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(backend.connections).toBe(connectionCount);
		expect(backend.activeConnections).toBe(0);
		expect(publishes()).toHaveLength(2);
	});

	it("publishes committed tool calls before their computer action", async () => {
		backend = await startStubBackend();
		runtime = await createInteractiveComputerUse({
			config: makeConfig(),
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
		});
		if (!runtime) throw new Error("computer-use host was not created");
		await runtime.driverRecordingHooks.onEvent?.({
			type: "message-added",
			snapshot: { agentId: "driver-agent" } as never,
			message: {
				id: "before-action",
				role: "assistant",
				content: [
					{ type: "text", text: "Inspecting the desktop" },
					{
						type: "tool-call",
						toolCallId: "screen",
						toolName: "computer",
						input: { action: "screenshot" },
					},
				],
				createdAt: 0,
			},
		});
		await tool("computer").execute({ action: "screenshot" }, toolContext);
		expect(backend.requests.map(({ action }) => action)).toEqual([
			"get_display_info",
			"publish_event",
			"publish_event",
			"screenshot",
		]);
	});

	it.each([
		undefined,
		"exit 9",
	])("closes the shared connection when startup fails with launch command %s", async (command) => {
		backend = await startStubBackend("screen handle is invalid");
		await expect(
			createInteractiveComputerUse({
				config: makeConfig(),
				env: {
					CLINE_COMPUTER_USE_PORT: String(backend.port),
					CLINE_COMPUTER_USE_BACKEND_COMMAND: command,
				},
			}),
		).rejects.toThrow("screen handle is invalid");

		expect(backend.requests.map((request) => request.action)).toEqual([
			"get_display_info",
		]);
		expect(backend.connections).toBe(1);
		await vi.waitFor(() => expect(backend?.activeConnections).toBe(0));
	});

	it("reports a failed launch without leaving a backend listening", async () => {
		const port = await freePort();
		await expect(
			createInteractiveComputerUse({
				config: makeConfig(),
				env: {
					CLINE_COMPUTER_USE_PORT: String(port),
					CLINE_COMPUTER_USE_BACKEND_COMMAND: "exit 9",
				},
			}),
		).rejects.toThrow("Computer-use backend failed to start:");
		expect(await portAcceptsConnections(port)).toBe(false);
	});
});
