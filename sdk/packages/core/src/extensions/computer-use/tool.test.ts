import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerUseClient } from "./client";
import type { ComputerUseResponse } from "./protocol";
import { createComputerUseTool } from "./tool";

/**
 * Stub backend mirroring the real qbt contract: like the Rust server, it
 * always answers `get_display_info` (with a fixed 1024x768 unless the test's
 * `respond` handles it first) since tool construction depends on that query.
 * Other actions go to the test's `respond`.
 */
function startFakeBackend(
	respond: (
		request: Record<string, unknown>,
	) => ComputerUseResponse | Promise<ComputerUseResponse>,
	displayInfo: { widthPx: number; heightPx: number } | null = {
		widthPx: 1024,
		heightPx: 768,
	},
): Promise<{ server: Server; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.trim().length > 0) {
						const request = JSON.parse(line) as Record<string, unknown>;
						const response =
							request.action === "get_display_info"
								? displayInfo
									? {
											id: request.id as number,
											ok: true,
											display: displayInfo,
										}
									: {
											id: request.id as number,
											ok: false,
											error: "display unavailable",
										}
								: respond(request);
						void Promise.resolve(response).then((result) => {
							if (!socket.destroyed) {
								socket.write(`${JSON.stringify(result)}\n`);
							}
						});
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({ server, port: address.port });
		});
	});
}

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("createComputerUseTool", () => {
	let server: Server | undefined;
	let client: ComputerUseClient | undefined;

	afterEach(async () => {
		client?.close();
		client = undefined;
		vi.restoreAllMocks();
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	});

	it("maps run_sequence steps, brief_pause, and expect_unchanged onto the wire format", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const started = await startFakeBackend((request) => {
			seen.push(request);
			return {
				id: request.id as number,
				ok: true,
				text: "Executed 3 actions.",
				image: { data: "aGk=", mediaType: "image/png" },
			};
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({ client, port: started.port });
		expect(tool.inputSchema).toMatchObject({
			properties: {
				actions: {
					items: {
						properties: {
							region: { minItems: 4, maxItems: 4 },
							expect_unchanged: { minItems: 4, maxItems: 4 },
						},
					},
				},
			},
		});
		const output = (await tool.execute(
			{
				action: "run_sequence",
				actions: [
					{
						action: "left_click",
						coordinate: [10, 20],
						expect_unchanged: [0, 0, 30, 40],
					},
					{ action: "brief_pause" },
					{ action: "zoom", region: [0, 0, 30, 40] },
				],
			},
			ctx,
		)) as Array<{ type: string; text?: string }>;

		expect(seen[0]).toMatchObject({
			action: "run_sequence",
			actions: [
				{
					action: "left_click",
					coordinate: [10, 20],
					expectUnchanged: [0, 0, 30, 40],
				},
				{ action: "brief_pause" },
				{ action: "zoom", region: [0, 0, 30, 40] },
			],
		});
		expect(output[0]).toMatchObject({
			type: "text",
			text: "Executed 3 actions.",
		});
		expect(output[1]).toMatchObject({ type: "image" });
	});

	it("maps mark, list_marks, flipbook, and clear_marks onto the wire format", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const started = await startFakeBackend((request) => {
			seen.push(request);
			return {
				id: request.id as number,
				ok: true,
				text: `${request.action} done`,
			};
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const tool = await createComputerUseTool({ client, port: started.port });
		expect(tool.description).toContain("mark step with a short label");

		await tool.execute({ action: "mark", label: " Editor open " }, ctx);
		await tool.execute(
			{
				action: "run_sequence",
				actions: [
					{ action: "brief_pause" },
					{ action: "mark", label: "After pause" },
				],
			},
			ctx,
		);
		await tool.execute({ action: "list_marks" }, ctx);
		const flipbook = await tool.execute(
			{ action: "flipbook", name: "Grapefruit run", marks: "2-" },
			ctx,
		);
		await tool.execute({ action: "clear_marks", marks: [1, 3] }, ctx);

		expect(seen.map((request) => request.action)).toEqual([
			"mark",
			"run_sequence",
			"list_marks",
			"flipbook",
			"clear_marks",
		]);
		expect(seen[0]).toMatchObject({ label: "Editor open" });
		expect(seen[1]).toMatchObject({
			actions: [
				{ action: "brief_pause" },
				{ action: "mark", label: "After pause" },
			],
		});
		expect(seen[3]).toMatchObject({ name: "Grapefruit run", marks: "2-" });
		expect(seen[3]).not.toHaveProperty("label");
		expect(seen[4]).toMatchObject({ marks: [1, 3] });
		expect(flipbook).toBe("flipbook done");

		// Only mark may be a sequence step; the others answer with text the
		// caller would never see.
		for (const action of ["list_marks", "flipbook", "clear_marks"]) {
			await expect(
				tool.execute(
					{ action: "run_sequence", actions: [{ action, name: "x" }] },
					ctx,
				),
			).rejects.toThrow();
		}
		await expect(tool.execute({ action: "mark" }, ctx)).rejects.toThrow(
			"label is required for mark",
		);
		await expect(
			tool.execute({ action: "mark", label: "   " }, ctx),
		).rejects.toThrow();
		await expect(tool.execute({ action: "flipbook" }, ctx)).rejects.toThrow(
			"name is required for flipbook",
		);
		await expect(
			tool.execute({ action: "screenshot", name: "x" }, ctx),
		).rejects.toThrow("name is only valid for flipbook");
		await expect(
			tool.execute({ action: "list_marks", marks: "1-2" }, ctx),
		).rejects.toThrow("marks is only valid for flipbook and clear_marks");
		await expect(
			tool.execute({ action: "clear_marks", marks: [0] }, ctx),
		).rejects.toThrow();
		expect(seen).toHaveLength(5);
	});

	it("maps expect_unchanged onto the wire format", async () => {
		const seenGuard: Array<Record<string, unknown>> = [];
		const guardBackend = await startFakeBackend((request) => {
			seenGuard.push(request);
			return { id: request.id as number, ok: true };
		});
		server = guardBackend.server;
		client = new ComputerUseClient({ port: guardBackend.port });
		const guardTool = await createComputerUseTool({
			client,
			port: guardBackend.port,
		});
		await guardTool.execute(
			{
				action: "left_click",
				coordinate: [5, 6],
				expect_unchanged: [1, 2, 3, 4],
			},
			ctx,
		);
		expect(seenGuard[0]).toMatchObject({
			action: "left_click",
			coordinate: [5, 6],
			expectUnchanged: [1, 2, 3, 4],
		});
	});

	it("keeps the fresh screenshot when a guarded sequence aborts", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			aborted: true,
			image: { data: "aGk=", mediaType: "image/png" },
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const tool = await createComputerUseTool({ client, port: started.port });
		const output = await tool.execute(
			{
				action: "run_sequence",
				actions: [{ action: "left_click", coordinate: [5, 6] }],
			},
			ctx,
		);
		expect(output).toEqual([
			{
				type: "text",
				text: 'Action "run_sequence" aborted. Reassess the screen before continuing.',
			},
			{ type: "image", data: "aGk=", mediaType: "image/png" },
		]);
	});

	it("exposes the computer tool name and an object input schema", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		expect(tool.name).toBe("computer");
		expect(tool.inputSchema.type).toBe("object");
		expect(tool.description).toContain("1024x768");
	});

	it("exposes the same strict raw-action and numeric constraints used at runtime", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const tool = await createComputerUseTool({ client, port: started.port });
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["action"],
			properties: {
				coordinate: {
					minItems: 2,
					maxItems: 2,
					items: { type: "integer", minimum: 0, maximum: 2_147_483_647 },
				},
				duration: { type: "number", minimum: 0, maximum: 120 },
				scroll_amount: { type: "integer", minimum: 0, maximum: 4_294_967_295 },
				actions: {
					minItems: 1,
					maxItems: 20,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							region: { minItems: 4, maxItems: 4 },
							expect_unchanged: { minItems: 4, maxItems: 4 },
						},
					},
				},
			},
		});
		const properties = tool.inputSchema.properties as Record<
			string,
			Record<string, unknown>
		>;
		const steps = properties.actions.items as {
			properties: Record<string, { enum?: string[] }>;
		};
		expect(properties.action.enum).toEqual([
			...((steps.properties.action.enum ?? []) as string[]),
			"list_marks",
			"flipbook",
			"clear_marks",
			"run_sequence",
		]);
		expect(steps.properties.action.enum).toContain("mark");
		expect(steps.properties).toHaveProperty("label");
		expect(steps.properties).not.toHaveProperty("name");
		expect(steps.properties).not.toHaveProperty("marks");
		for (const action of [
			"get_display_info",
			"publish_event",
			"shutdown_backend",
			"get_clipboard",
			"set_clipboard",
		]) {
			expect(properties.action.enum).not.toContain(action);
		}
		expect(steps.properties).not.toHaveProperty("actions");
		expect(JSON.stringify(tool.inputSchema)).not.toContain("prefixItems");
		expect(tool.description).toContain("120-second estimated work budget");
		expect(tool.description).toContain("Split oversized");
		expect(tool.timeoutMs).toBe(183_000);
	});

	it("rejects malformed and missing action inputs before enrollment, recovery, or sending", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const beforeAction = vi.fn(async () => undefined);
		const ensureRunning = vi.fn(async () => ({
			status: "already_running" as const,
		}));
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction,
			backendAvailability: { budgetMs: 1_000, ensureRunning },
		});
		const send = vi.spyOn(client, "send");
		const invalid: unknown[] = [
			null,
			[],
			"screenshot",
			{},
			{ action: 1 },
			{ action: "unknown_action" },
			{ action: "get_display_info" },
			{ action: "publish_event", kind: "event", payload: {} },
			{ action: "shutdown_backend" },
			{ action: "get_clipboard" },
			{ action: "set_clipboard", text: "secret" },
			{ action: "screenshot", id: 1 },
			{ action: "key", text: "ctrl+c", keys: ["ctrl", "c"] },
			{ action: "screenshot", actions: [{ action: "screenshot" }] },
			{ action: "mouse_move", coordinate: [0] },
			{ action: "mouse_move", coordinate: [0, 1, 2] },
			{ action: "mouse_move", coordinate: [0.5, 1] },
			{ action: "mouse_move", coordinate: [-1, 1] },
			{ action: "mouse_move", coordinate: [Number.NaN, 1] },
			{ action: "mouse_move", coordinate: [Number.POSITIVE_INFINITY, 1] },
			{ action: "mouse_move", coordinate: [2_147_483_648, 1] },
			{ action: "mouse_move", coordinate: [Number.MAX_SAFE_INTEGER + 1, 1] },
			{ action: "left_click_drag", coordinate: [0, 1], start_coordinate: [0] },
			{ action: "zoom", region: [0, 1, 2] },
			{ action: "zoom", region: [0, 1, 2, 3, 4] },
			{ action: "zoom", region: [0, 1, 2, -3] },
			{ action: "zoom", region: [0, 1, 2, 3.5] },
			{ action: "zoom", region: [0, 1, 2, 2_147_483_648] },
			{ action: "left_click", coordinate: [0, 1], expect_unchanged: [0, 1] },
			{
				action: "left_click",
				coordinate: [0, 1],
				expect_unchanged: [0, 1, 2, -3],
			},
			{ action: "wait", duration: -1 },
			{ action: "wait", duration: Number.NaN },
			{ action: "wait", duration: Number.POSITIVE_INFINITY },
			{ action: "wait", duration: 120.01 },
			{ action: "wait", duration: "1" },
			{ action: "hold_key", text: "shift", duration: -0.5 },
			{ action: "type", text: 123 },
			{ action: "key", text: null },
			{
				action: "scroll",
				coordinate: [0, 1],
				scroll_direction: "diagonal",
				scroll_amount: 1,
			},
			{
				action: "scroll",
				coordinate: [0, 1],
				scroll_direction: "down",
				scroll_amount: -1,
			},
			{
				action: "scroll",
				coordinate: [0, 1],
				scroll_direction: "down",
				scroll_amount: 1.5,
			},
			{
				action: "scroll",
				coordinate: [0, 1],
				scroll_direction: "down",
				scroll_amount: Number.NaN,
			},
			{
				action: "scroll",
				coordinate: [0, 1],
				scroll_direction: "down",
				scroll_amount: 4_294_967_296,
			},
			{ action: "run_sequence" },
			{ action: "run_sequence", actions: [] },
			{
				action: "run_sequence",
				actions: Array.from({ length: 21 }, () => ({ action: "screenshot" })),
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "run_sequence", actions: [{ action: "screenshot" }] },
				],
			},
			{
				action: "run_sequence",
				actions: [{ action: "screenshot", actions: [] }],
			},
			{ action: "run_sequence", actions: [{ action: "get_clipboard" }] },
			{ action: "run_sequence", actions: [{ action: "get_display_info" }] },
			{ action: "run_sequence", actions: [{ action: "publish_event" }] },
			{ action: "run_sequence", actions: [{ action: "shutdown_backend" }] },
			{
				action: "run_sequence",
				actions: [{ action: "screenshot" }, { action: "wait", duration: -1 }],
			},
			{
				action: "run_sequence",
				actions: [{ action: "screenshot" }, { action: "left_click" }],
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "screenshot" },
					{ action: "screenshot", extra: true },
				],
			},
		];
		for (const action of [
			"mouse_move",
			"left_click",
			"right_click",
			"middle_click",
			"double_click",
			"triple_click",
			"left_mouse_down",
			"left_mouse_up",
			"key",
			"type",
			"wait",
			"zoom",
		]) {
			invalid.push({ action });
		}
		invalid.push(
			{ action: "left_click_drag", coordinate: [0, 1] },
			{ action: "left_click_drag", start_coordinate: [0, 1] },
			{ action: "hold_key", text: "shift" },
			{ action: "hold_key", duration: 1 },
			{ action: "scroll", coordinate: [0, 1], scroll_direction: "up" },
			{ action: "scroll", coordinate: [0, 1], scroll_amount: 1 },
			{ action: "scroll", scroll_direction: "up", scroll_amount: 1 },
		);
		for (const input of invalid) {
			await expect(
				tool.execute(input, ctx),
				JSON.stringify(input),
			).rejects.toThrow();
		}
		expect(beforeAction).not.toHaveBeenCalled();
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		expect(seen).toEqual([]);
	});

	it("bounds aggregate waits, holds, Unicode typing, pauses, and step overhead before side effects", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true, text: "completed" };
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const beforeAction = vi.fn(async () => undefined);
		const ensureRunning = vi.fn(async () => ({
			status: "already_running" as const,
		}));
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction,
			backendAvailability: { budgetMs: 1_000, ensureRunning },
		});
		const send = vi.spyOn(client, "send");
		const oversized: unknown[] = [
			{ action: "wait", duration: 120 },
			{ action: "hold_key", text: "shift", duration: 119.751 },
			{ action: "type", text: "a".repeat(1_331) },
			{ action: "type", text: "😀".repeat(1_331) },
			{
				action: "run_sequence",
				actions: [
					{ action: "wait", duration: 60 },
					{ action: "hold_key", text: "shift", duration: 60 },
				],
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "wait", duration: 119.201 },
					{ action: "brief_pause" },
				],
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "type", text: "😀".repeat(1_301) },
					{ action: "wait", duration: 2.5 },
				],
			},
		];
		for (const input of oversized) {
			await expect(tool.execute(input, ctx)).rejects.toThrow(
				"Split oversized waits, typing, or sequences across calls",
			);
		}
		expect(beforeAction).not.toHaveBeenCalled();
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		expect(seen).toEqual([]);

		const withinBudget: unknown[] = [
			{ action: "wait", duration: 0 },
			{ action: "wait", duration: 119.75 },
			{ action: "hold_key", text: "shift", duration: 119.75 },
			{ action: "type", text: "" },
			{ action: "type", text: "a".repeat(1_330) },
			{ action: "type", text: "😀".repeat(1_330) },
			{
				action: "run_sequence",
				actions: [
					{ action: "wait", duration: 60 },
					{ action: "hold_key", text: "shift", duration: 59.5 },
				],
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "wait", duration: 119.2 },
					{ action: "brief_pause" },
				],
			},
			{
				action: "run_sequence",
				actions: [
					{ action: "type", text: "😀".repeat(1_300) },
					{ action: "wait", duration: 2.5 },
				],
			},
			{
				action: "run_sequence",
				actions: Array.from({ length: 20 }, () => ({ action: "screenshot" })),
			},
		];
		for (const input of withinBudget) {
			await expect(tool.execute(input, ctx)).resolves.toBe("completed");
		}
		expect(beforeAction).toHaveBeenCalledTimes(withinBudget.length);
		expect(ensureRunning).toHaveBeenCalledTimes(withinBudget.length);
		expect(send).toHaveBeenCalledTimes(withinBudget.length);
		expect(seen).toHaveLength(withinBudget.length);
	});

	it("awaits journal enrollment before recovery or action delivery", async () => {
		const order: string[] = [];
		const started = await startFakeBackend((request) => {
			order.push("action");
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		let finishEnrollment!: () => void;
		const enrolled = new Promise<void>((resolve) => {
			finishEnrollment = resolve;
		});
		const beforeAction = vi.fn(async () => {
			order.push("enroll");
			await enrolled;
			order.push("enrolled");
		});
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction,
			backendAvailability: {
				budgetMs: 1_000,
				ensureRunning: async () => {
					order.push("recover");
					return { status: "already_running" };
				},
			},
		});
		const send = vi.spyOn(client, "send");
		const result = tool.execute({ action: "screenshot" }, ctx);
		await Promise.resolve();
		expect(order).toEqual(["enroll"]);
		expect(send).not.toHaveBeenCalled();
		finishEnrollment();
		await expect(result).resolves.toBe('Action "screenshot" completed.');
		expect(order).toEqual(["enroll", "enrolled", "recover", "action"]);
		expect(beforeAction).toHaveBeenCalledOnce();
	});

	it("does not recover or send when journal enrollment rejects", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const ensureRunning = vi.fn(async () => ({
			status: "already_running" as const,
		}));
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction: async () => {
				throw new Error("journal enrollment failed");
			},
			backendAvailability: { budgetMs: 1_000, ensureRunning },
		});
		const send = vi.spyOn(client, "send");
		await expect(tool.execute({ action: "screenshot" }, ctx)).rejects.toThrow(
			"journal enrollment failed",
		);
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("does not enroll, recover, or send an already-cancelled action", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const beforeAction = vi.fn(async () => undefined);
		const ensureRunning = vi.fn(async () => ({
			status: "already_running" as const,
		}));
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction,
			backendAvailability: { budgetMs: 1_000, ensureRunning },
		});
		const send = vi.spyOn(client, "send");
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(
			tool.execute(
				{ action: "screenshot" },
				{ ...ctx, signal: controller.signal },
			),
		).rejects.toThrow("cancelled");
		expect(beforeAction).not.toHaveBeenCalled();
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("does not recover or send after cancellation during enrollment", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const controller = new AbortController();
		const ensureRunning = vi.fn(async () => ({
			status: "already_running" as const,
		}));
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			beforeAction: async () => controller.abort(new Error("cancelled")),
			backendAvailability: { budgetMs: 1_000, ensureRunning },
		});
		const send = vi.spyOn(client, "send");
		await expect(
			tool.execute(
				{ action: "screenshot" },
				{ ...ctx, signal: controller.signal },
			),
		).rejects.toThrow("cancelled");
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("uses a separate long-action deadline without extending client probes or journals", async () => {
		const started = await startFakeBackend(async (request) => {
			// Simulate backend work that exceeds the tiny client default, without
			// actually waiting 20 seconds or typing 200 characters.
			await new Promise((resolve) => setTimeout(resolve, 100));
			return { id: request.id as number, ok: true, text: "completed" };
		});
		server = started.server;
		client = new ComputerUseClient({
			port: started.port,
			requestTimeoutMs: 25,
		});
		const tool = await createComputerUseTool({
			client,
			port: started.port,
			connectTimeoutMs: 5_000,
			backendAvailability: {
				budgetMs: 1_000,
				ensureRunning: async () => ({ status: "already_running" }),
			},
		});
		const send = vi.spyOn(client, "send");
		const controller = new AbortController();
		for (const input of [
			{ action: "wait", duration: 20 },
			{ action: "type", text: "a".repeat(200) },
			{
				action: "run_sequence",
				actions: [
					{ action: "wait", duration: 20 },
					{ action: "type", text: "a".repeat(200) },
				],
			},
		]) {
			await expect(
				tool.execute(input, { ...ctx, signal: controller.signal }),
			).resolves.toBe("completed");
		}
		expect(tool.timeoutMs).toBe(186_000);
		for (const [_request, options] of send.mock.calls) {
			expect(options).toEqual({
				signal: controller.signal,
				requestTimeoutMs: 150_000,
			});
		}
		await expect(
			client.send({ action: "publish_event", kind: "test", payload: {} }),
		).rejects.toThrow("timed out after 25ms");
		await expect(client.send({ action: "screenshot" })).rejects.toThrow(
			"timed out after 25ms",
		);
	});

	it("closes its private client when tool construction fails", async () => {
		const started = await startFakeBackend(
			(request) => ({ id: request.id as number, ok: true }),
			null,
		);
		server = started.server;
		const connectionClosed = new Promise<void>((resolve) => {
			server?.once("connection", (socket) => socket.once("close", resolve));
		});
		const close = vi.spyOn(ComputerUseClient.prototype, "close");
		await expect(createComputerUseTool({ port: started.port })).rejects.toThrow(
			"display unavailable",
		);
		expect(close).toHaveBeenCalledOnce();
		const ownedClient = close.mock.contexts[0] as ComputerUseClient;
		expect(ownedClient).toBeInstanceOf(ComputerUseClient);
		// The server saw a real display-info connection; it must not be left open.
		await connectionClosed;
		await new Promise<void>((resolve, reject) => {
			server?.getConnections((error, count) => {
				if (error) reject(error);
				else {
					expect(count).toBe(0);
					resolve();
				}
			});
		});
	});

	it("leaves an injected client open when tool construction fails", async () => {
		const started = await startFakeBackend(
			(request) => ({ id: request.id as number, ok: true, text: "still open" }),
			null,
		);
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const close = vi.spyOn(client, "close");
		await expect(
			createComputerUseTool({ client, port: started.port }),
		).rejects.toThrow("display unavailable");
		expect(close).not.toHaveBeenCalled();
		await expect(client.send({ action: "screenshot" })).resolves.toMatchObject({
			ok: true,
			text: "still open",
		});
	});

	it("embeds the backend-reported display size in the description", async () => {
		const started = await startFakeBackend(
			(request) => ({
				id: request.id as number,
				ok: true,
			}),
			{ widthPx: 1920, heightPx: 1080 },
		);
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		expect(tool.description).toContain("1920x1080");
	});

	it("returns a screenshot as multimodal text+image content", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: "screenshot taken",
			image: { data: "ZmFrZS1wbmc=", mediaType: "image/png" },
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		const result = await tool.execute({ action: "screenshot" }, ctx);

		expect(result).toEqual([
			{ type: "text", text: "screenshot taken" },
			{ type: "image", data: "ZmFrZS1wbmc=", mediaType: "image/png" },
		]);
	});

	it("ensures the backend is running before each action", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true, text: "ready" };
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const readiness: string[] = [];
		const tool = await createComputerUseTool({
			port: started.port,
			client,
			backendAvailability: {
				budgetMs: 1_000,
				ensureRunning: async () => {
					readiness.push("checked");
					return { status: "already_running" };
				},
			},
		});

		await expect(tool.execute({ action: "screenshot" }, ctx)).resolves.toBe(
			"ready",
		);
		expect(readiness).toEqual(["checked"]);
		expect(seen).toEqual(["screenshot"]);
		expect(tool.timeoutMs).toBe(184_000);
	});

	it("does not send the action when backend recovery fails", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		client = new ComputerUseClient({ port: started.port });
		const tool = await createComputerUseTool({
			port: started.port,
			client,
			backendAvailability: {
				budgetMs: 1_000,
				ensureRunning: async () => ({
					status: "failed_to_start",
					error: "launch failed",
				}),
			},
		});

		await expect(tool.execute({ action: "screenshot" }, ctx)).rejects.toThrow(
			"Computer-use backend recovery failed: launch failed",
		);
		expect(seen).toEqual([]);
	});

	it("returns plain text when the backend does not return an image", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: "clicked at (10, 20)",
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		const result = await tool.execute(
			{ action: "left_click", coordinate: [10, 20] },
			ctx,
		);

		expect(result).toBe("clicked at (10, 20)");
	});

	// The backend contract (qwanban qbt/src/computer_use.rs) reads key combos
	// from `text` for Key/HoldKey; a separate `keys` field does not exist on
	// the wire.
	it("sends key combinations in the text field for key/hold_key", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: `keys=${request.keys ?? "none"} text=${request.text ?? "none"}`,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		const result = await tool.execute(
			{ action: "key", text: "ctrl+alt+delete" },
			ctx,
		);

		expect(result).toBe("keys=none text=ctrl+alt+delete");
		await expect(
			tool.execute({ action: "hold_key", text: "shift", duration: 0.5 }, ctx),
		).resolves.toBe("keys=none text=shift");
	});

	it("throws with the backend error message on failure", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: false,
			error: "no display attached",
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		await expect(tool.execute({ action: "screenshot" }, ctx)).rejects.toThrow(
			"no display attached",
		);
	});
});
