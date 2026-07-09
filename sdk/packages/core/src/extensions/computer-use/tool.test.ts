import type { AgentToolContext } from "@cline/shared";
import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerUseClient } from "./client";
import type { ComputerUseResponse } from "./protocol";
import { createComputerUseTool } from "./tool";

function startFakeBackend(
	respond: (request: Record<string, unknown>) => ComputerUseResponse,
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
						socket.write(`${JSON.stringify(respond(request))}\n`);
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
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
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
			displayWidthPx: 1024,
			displayHeightPx: 768,
			client,
		});

		expect(tool.name).toBe("computer");
		expect(tool.inputSchema.type).toBe("object");
		expect(tool.description).toContain("1024x768");
	});

	it("queries the backend for display size when no override is provided", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			display: { widthPx: 1920, heightPx: 1080 },
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			client,
		});

		expect(tool.description).toContain("1920x1080");
	});

	it("uses a single override without querying the backend for the other dimension", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			display: { widthPx: 1920, heightPx: 1080 },
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			displayWidthPx: 640,
			client,
		});

		expect(tool.description).toContain("640x1080");
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
			displayWidthPx: 1024,
			displayHeightPx: 768,
			client,
		});

		const result = await tool.execute({ action: "screenshot" }, ctx);

		expect(result).toEqual([
			{ type: "text", text: "screenshot taken" },
			{ type: "image", data: "ZmFrZS1wbmc=", mediaType: "image/png" },
		]);
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
			displayWidthPx: 1024,
			displayHeightPx: 768,
			client,
		});

		const result = await tool.execute(
			{ action: "left_click", coordinate: [10, 20] },
			ctx,
		);

		expect(result).toBe("clicked at (10, 20)");
	});

	it("maps key/hold_key text into the keys field, not the text field", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: `keys=${request.keys ?? "none"} text=${request.text ?? "none"}`,
		}));
		server = started.server;
		client = new ComputerUseClient({ port: started.port });

		const tool = await createComputerUseTool({
			port: started.port,
			displayWidthPx: 1024,
			displayHeightPx: 768,
			client,
		});

		const result = await tool.execute(
			{ action: "key", text: "ctrl+alt+delete" },
			ctx,
		);

		expect(result).toBe("keys=ctrl+alt+delete text=none");
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
			displayWidthPx: 1024,
			displayHeightPx: 768,
			client,
		});

		await expect(tool.execute({ action: "screenshot" }, ctx)).rejects.toThrow(
			"no display attached",
		);
	});
});
