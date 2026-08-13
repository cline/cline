import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const mocks = vi.hoisted(() => ({
	handleCommand: vi.fn(),
}));

vi.mock("./commands", () => ({
	handleCommand: mocks.handleCommand,
}));

import { createFetchHandler } from "./server";

const server = {
	port: 3126,
	upgrade: vi.fn(() => true),
};

describe("realtime session endpoint", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the short-lived realtime setup expected by the AI SDK hook", async () => {
		mocks.handleCommand.mockResolvedValue({
			kind: "realtime",
			providerId: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime",
			supportsTools: true,
			token: "ephemeral-token",
			url: "wss://realtime.example.test/session",
			expiresAt: 1_785_280_000,
			transport: "vercel-ai-gateway",
			sessionConfig: { outputModalities: ["audio"] },
		});
		const ctx = {} as SidecarContext;
		const response = await createFetchHandler(ctx, vi.fn())(
			new Request("http://127.0.0.1:3126/api/modes/realtime/session", {
				method: "POST",
				headers: { origin: "tauri://localhost" },
			}),
			server,
		);

		expect(mocks.handleCommand).toHaveBeenCalledWith(
			ctx,
			"create_mode_session",
			{ mode: "realtimeVoice" },
		);
		expect(response?.status).toBe(200);
		if (!response) throw new Error("Missing realtime endpoint response");
		await expect(response.json()).resolves.toEqual({
			token: "ephemeral-token",
			url: "wss://realtime.example.test/session",
			expiresAt: 1_785_280_000,
			tools: [
				{
					type: "function",
					name: "run_cline",
					description:
						"Send the user's complete request to the active Cline agent. You must call this exactly once for every user utterance. Cline owns conversation history, workspace context, tools, MCP, approvals, and persistence. After the tool returns, speak its response faithfully.",
					parameters: {
						type: "object",
						properties: {
							request: {
								type: "string",
								description:
									"The user's complete request, preserving all relevant detail.",
							},
						},
						required: ["request"],
						additionalProperties: false,
					},
				},
			],
		});
	});

	it("does not invoke the sidecar command for an untrusted origin", async () => {
		const response = await createFetchHandler({} as SidecarContext, vi.fn())(
			new Request("http://127.0.0.1:3126/api/modes/realtime/session", {
				method: "POST",
				headers: { origin: "https://attacker.example" },
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(mocks.handleCommand).not.toHaveBeenCalled();
	});
});
