import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
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
	respond: (request: Record<string, unknown>) => ComputerUseResponse,
	displayInfo: { widthPx: number; heightPx: number } = {
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
						const response: ComputerUseResponse =
							request.action === "get_display_info"
								? {
										id: request.id as number,
										ok: true,
										display: displayInfo,
									}
								: respond(request);
						socket.write(`${JSON.stringify(response)}\n`);
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
			client,
		});

		expect(tool.name).toBe("computer");
		expect(tool.inputSchema.type).toBe("object");
		expect(tool.description).toContain("1024x768");
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
