import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool, AgentToolContext, Message } from "@cline/core";
// biome-ignore lint/style/noRestrictedImports: repository integration coverage must invoke the real internal sandbox loader.
import { loadSandboxedPlugins } from "../../../packages/core/src/extensions/plugin/plugin-sandbox";
import { ComputerUseClient } from "./client";
import { createComputerUsePlugin } from "./index";
import type { ComputerUseResponse } from "./protocol";

interface FakeBackend {
	server: Server;
	port: number;
	close(): Promise<void>;
}

async function startBackend(
	respond: (
		request: Record<string, unknown>,
	) => ComputerUseResponse | Promise<ComputerUseResponse>,
): Promise<FakeBackend> {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line) {
					const request = JSON.parse(line) as Record<string, unknown>;
					void Promise.resolve(respond(request)).then((response) => {
						socket.write(`${JSON.stringify(response)}\n`);
					});
				}
				newline = buffer.indexOf("\n");
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		server,
		port: (server.address() as { port: number }).port,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

function capturePluginApi() {
	const tools: AgentTool[] = [];
	const messageBuilders: Array<{
		name: string;
		build(messages: Message[]): Message[] | Promise<Message[]>;
	}> = [];
	return {
		tools,
		messageBuilders,
		api: {
			registerTool: (tool: AgentTool) => tools.push(tool),
			registerCommand: () => {},
			registerRule: () => {},
			registerMessageBuilder: (builder: {
				name: string;
				build(messages: Message[]): Message[] | Promise<Message[]>;
			}) => messageBuilders.push(builder),
			registerProvider: () => {},
			registerAutomationEventType: () => {},
			registerMcpServer: () => {},
		},
	};
}

const context: AgentToolContext = {
	sessionId: "session-test",
	agentId: "agent-test",
	conversationId: "conversation-test",
	iteration: 1,
};

describe("computer-use plugin", () => {
	let backend: FakeBackend | undefined;
	let client: ComputerUseClient | undefined;
	let jobsDir: string | undefined;
	const events: Array<{ name: string; payload?: unknown }> = [];

	afterEach(async () => {
		client?.close();
		client = undefined;
		await backend?.close();
		backend = undefined;
		if (jobsDir) rmSync(jobsDir, { recursive: true, force: true });
		jobsDir = undefined;
		events.length = 0;
		globalThis.__clinePluginHost = undefined;
	});

	async function setupPlugin(delayMs: number) {
		backend = await startBackend(async (request) => {
			if (delayMs > 0)
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			return {
				id: request.id as number,
				ok: true,
				text: `handled ${request.action as string}`,
				image: { data: "c2NyZWVu", mediaType: "image/png" },
			};
		});
		client = new ComputerUseClient({
			port: backend.port,
			requestTimeoutMs: 5_000,
		});
		jobsDir = mkdtempSync(join(tmpdir(), "computer-use-plugin-"));
		globalThis.__clinePluginHost = {
			emitEvent: (name, payload) => events.push({ name, payload }),
		};
		const captured = capturePluginApi();
		const plugin = createComputerUsePlugin({
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
			client,
			displayInfo: { widthPx: 1024, heightPx: 768 },
			jobsDir,
			requestTimeoutMs: 5_000,
		});
		await plugin.setup?.(captured.api, {
			session: { sessionId: context.sessionId },
		});
		return captured;
	}

	it("returns fast actions directly with their screenshot", async () => {
		const { tools } = await setupPlugin(0);
		const computer = tools.find((tool) => tool.name === "computer");
		const result = await computer?.execute(
			{ action: "screenshot", deadline_ms: 1_000 },
			context,
		);
		expect(result).toEqual([
			{ type: "text", text: "handled screenshot" },
			{ type: "image", data: "c2NyZWVu", mediaType: "image/png" },
		]);
		expect(events).toEqual([]);
	});

	it("promotes slow actions to jobs, steers, and returns the image on poll", async () => {
		const { tools } = await setupPlugin(75);
		const computer = tools.find((tool) => tool.name === "computer");
		const poll = tools.find((tool) => tool.name === "computer_poll");
		const start = (await computer?.execute(
			{ action: "left_click", coordinate: [5, 6], deadline_ms: 1 },
			context,
		)) as { jobId: string; status: string };
		expect(start.status).toBe("running");

		let result: unknown = { status: "running" };
		for (let attempt = 0; attempt < 30; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = await poll?.execute({ job_id: start.jobId }, context);
			if (Array.isArray(result)) break;
		}
		expect(result).toEqual([
			{ type: "text", text: "handled left_click" },
			{ type: "image", data: "c2NyZWVu", mediaType: "image/png" },
		]);
		expect(events).toHaveLength(1);
		expect(events[0]?.name).toBe("steer_message");
		expect(events[0]?.payload).toMatchObject({
			sessionId: "session-test",
			prompt: expect.stringContaining(start.jobId),
		});
	});

	it("rejects overlapping computer actions while a job is active", async () => {
		const { tools } = await setupPlugin(100);
		const computer = tools.find((tool) => tool.name === "computer");
		const start = (await computer?.execute(
			{ action: "wait", duration: 1, deadline_ms: 0, notify: "none" },
			context,
		)) as { jobId: string };
		await expect(
			computer?.execute({ action: "screenshot", deadline_ms: 0 }, context),
		).rejects.toThrow(start.jobId);
	});

	it("cancels a promoted job and exposes its terminal status", async () => {
		const { tools } = await setupPlugin(1_000);
		const computer = tools.find((tool) => tool.name === "computer");
		const cancel = tools.find((tool) => tool.name === "computer_cancel");
		const poll = tools.find((tool) => tool.name === "computer_poll");
		const start = (await computer?.execute(
			{ action: "wait", duration: 10, deadline_ms: 0, notify: "none" },
			context,
		)) as { jobId: string };
		const cancellation = (await cancel?.execute(
			{ job_id: start.jobId },
			context,
		)) as { cancellationRequested: boolean };
		expect(cancellation.cancellationRequested).toBe(true);

		let result: unknown;
		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			result = await poll?.execute({ job_id: start.jobId }, context);
			if ((result as { status?: string })?.status === "cancelled") break;
		}
		expect(result).toMatchObject({ status: "cancelled" });
		expect(events).toEqual([]);
	});

	it("marks persisted running jobs failed when a plugin worker restarts", async () => {
		backend = await startBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		client = new ComputerUseClient({ port: backend.port });
		jobsDir = mkdtempSync(join(tmpdir(), "computer-use-plugin-recovery-"));
		writeFileSync(
			join(jobsDir, "orphan-job.json"),
			JSON.stringify({
				version: 1,
				jobId: "orphan-job",
				kind: "computer",
				status: "running",
				action: "wait",
				notify: "none",
				startedAt: new Date().toISOString(),
			}),
		);
		const captured = capturePluginApi();
		const plugin = createComputerUsePlugin({
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
			client,
			displayInfo: { widthPx: 1024, heightPx: 768 },
			jobsDir,
		});
		await plugin.setup?.(captured.api, {
			session: { sessionId: context.sessionId },
		});
		const poll = captured.tools.find((tool) => tool.name === "computer_poll");
		await expect(
			poll?.execute({ job_id: "orphan-job" }, context),
		).resolves.toMatchObject({
			status: "failed",
			error: expect.stringContaining("worker restarted"),
		});
	});

	it("surfaces backend failures that arrive before the deadline", async () => {
		backend = await startBackend((request) => ({
			id: request.id as number,
			ok: false,
			error: "no display attached",
		}));
		client = new ComputerUseClient({ port: backend.port });
		jobsDir = mkdtempSync(join(tmpdir(), "computer-use-plugin-failure-"));
		const captured = capturePluginApi();
		const plugin = createComputerUsePlugin({
			env: { CLINE_COMPUTER_USE_PORT: String(backend.port) },
			client,
			displayInfo: { widthPx: 1024, heightPx: 768 },
			jobsDir,
		});
		await plugin.setup?.(captured.api, {});
		const computer = captured.tools.find((tool) => tool.name === "computer");
		await expect(
			computer?.execute({ action: "screenshot", deadline_ms: 1_000 }, context),
		).rejects.toThrow("no display attached");
	});

	it("registers backend recovery and probes before launching", async () => {
		backend = await startBackend((request) => ({
			id: request.id as number,
			ok: true,
			display: { widthPx: 1024, heightPx: 768 },
		}));
		client = new ComputerUseClient({ port: backend.port });
		jobsDir = mkdtempSync(join(tmpdir(), "computer-use-plugin-restart-"));
		const captured = capturePluginApi();
		const plugin = createComputerUsePlugin({
			env: {
				CLINE_COMPUTER_USE_PORT: String(backend.port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: 'node -e "process.exitCode = 91"',
			},
			client,
			displayInfo: { widthPx: 1024, heightPx: 768 },
			jobsDir,
		});
		await plugin.setup?.(captured.api, {});
		const restart = captured.tools.find(
			(tool) => tool.name === "computer_restart_backend",
		);
		await expect(
			restart?.execute({ deadline_ms: 1_000 }, context),
		).resolves.toBe("Computer-use backend: already_running.");
	});

	it("collapses superseded computer screenshots in provider messages", async () => {
		const { messageBuilders } = await setupPlugin(0);
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "old",
						name: "computer",
						content: [{ type: "image", data: "b2xk", mediaType: "image/png" }],
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "new",
						name: "computer_poll",
						content: [{ type: "image", data: "bmV3", mediaType: "image/png" }],
					},
				],
			},
		];
		const projected = await messageBuilders[0]?.build(messages);
		const serialized = JSON.stringify(projected);
		expect(serialized).not.toContain("b2xk");
		expect(serialized).toContain("bmV3");
		expect(serialized).toContain("older computer screenshot omitted");
		expect(JSON.stringify(messages)).toContain("b2xk");
	});

	it("runs deadline jobs through the real plugin sandbox", async () => {
		backend = await startBackend(async (request) => {
			if (request.action === "get_display_info") {
				return {
					id: request.id as number,
					ok: true,
					display: { widthPx: 800, heightPx: 600 },
				};
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
			return {
				id: request.id as number,
				ok: true,
				text: "sandbox action complete",
				image: { data: "c2FuZGJveA==", mediaType: "image/png" },
			};
		});
		jobsDir = mkdtempSync(join(tmpdir(), "computer-use-sandbox-data-"));
		const previous = {
			port: process.env.CLINE_COMPUTER_USE_PORT,
			dataDir: process.env.CLINE_DATA_DIR,
		};
		process.env.CLINE_COMPUTER_USE_PORT = String(backend.port);
		process.env.CLINE_DATA_DIR = jobsDir;
		const sandboxEvents: Array<{ name: string; payload?: unknown }> = [];
		const sandboxed = await loadSandboxedPlugins({
			pluginPaths: [join(dirname(fileURLToPath(import.meta.url)), "index.ts")],
			cwd: process.cwd(),
			session: { sessionId: context.sessionId },
			onEvent: (event: { name: string; payload?: unknown }) =>
				sandboxEvents.push(event),
			importTimeoutMs: 30_000,
		});
		try {
			const captured = capturePluginApi();
			await sandboxed.extensions?.[0]?.setup?.(captured.api, {});
			const computer = captured.tools.find((tool) => tool.name === "computer");
			const poll = captured.tools.find((tool) => tool.name === "computer_poll");
			const start = (await computer?.execute(
				{ action: "screenshot", deadline_ms: 1 },
				context,
			)) as { jobId: string; status: string };
			expect(start.status).toBe("running");

			let result: unknown;
			for (let attempt = 0; attempt < 30; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				result = await poll?.execute({ job_id: start.jobId }, context);
				if (Array.isArray(result)) break;
			}
			expect(result).toEqual([
				{ type: "text", text: "sandbox action complete" },
				{ type: "image", data: "c2FuZGJveA==", mediaType: "image/png" },
			]);
			expect(sandboxEvents).toContainEqual({
				name: "steer_message",
				payload: expect.objectContaining({ sessionId: "session-test" }),
			});
		} finally {
			await sandboxed.shutdown();
			if (previous.port === undefined)
				delete process.env.CLINE_COMPUTER_USE_PORT;
			else process.env.CLINE_COMPUTER_USE_PORT = previous.port;
			if (previous.dataDir === undefined) delete process.env.CLINE_DATA_DIR;
			else process.env.CLINE_DATA_DIR = previous.dataDir;
		}
	}, 60_000);
});
