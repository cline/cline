import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types/messages";

const geminiConstructorSpy = vi.fn();
const geminiGetMessagesSpy = vi.fn();
const geminiCreateMessageSpy = vi.fn();

vi.mock("./gemini", () => {
	return {
		GeminiHandler: class {
			constructor(config: unknown) {
				geminiConstructorSpy(config);
			}

			getMessages(systemPrompt: string, messages: Message[]) {
				return geminiGetMessagesSpy(systemPrompt, messages);
			}

			createMessage(
				systemPrompt: string,
				messages: Message[],
				tools?: unknown[],
			) {
				return geminiCreateMessageSpy(systemPrompt, messages, tools);
			}

			getModel() {
				return {
					id: "gemini-2.5-pro",
					info: {
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						contextWindow: 1,
						maxTokens: 1,
					},
				};
			}
		},
	};
});

import { VertexHandler } from "./vertex";

describe("VertexHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes Gemini models through GeminiHandler with Vertex config defaults", () => {
		geminiGetMessagesSpy.mockReturnValue([
			{ role: "user", parts: [{ text: "ok" }] },
		]);

		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
			gcp: { projectId: "my-project" },
		});

		const messages: Message[] = [{ role: "user", content: "Hello" }];
		const converted = handler.getMessages("You are helpful.", messages);

		expect(geminiConstructorSpy).toHaveBeenCalledTimes(1);
		expect(geminiConstructorSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				region: "us-central1",
				gcp: expect.objectContaining({
					projectId: "my-project",
					region: "us-central1",
				}),
			}),
		);
		expect(geminiGetMessagesSpy).toHaveBeenCalledWith(
			"You are helpful.",
			messages,
		);
		expect(converted).toEqual([{ role: "user", parts: [{ text: "ok" }] }]);
	});

	it("uses Anthropic-style message conversion for Claude models", () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "claude-sonnet-4-5",
			gcp: { projectId: "my-project", region: "us-east5" },
		});

		const converted = handler.getMessages("System", [
			{ role: "user", content: "Hello Claude" },
		]);

		expect(geminiGetMessagesSpy).not.toHaveBeenCalled();
		expect(converted).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Hello Claude" }],
			},
		]);
	});

	it("requires gcp.projectId for Vertex provider", async () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
		});

		const stream = handler.createMessage("System", [
			{ role: "user", content: "Hello" },
		]);
		await expect(stream.next()).rejects.toThrow("gcp.projectId");
	});

	it("requires region for Claude models on Vertex", async () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "claude-sonnet-4-5",
			gcp: { projectId: "my-project" },
		});

		const stream = handler.createMessage("System", [
			{ role: "user", content: "Hello" },
		]);
		await expect(stream.next()).rejects.toThrow("gcp.region");
	});
});
