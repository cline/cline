#!/usr/bin/env bun
import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { createOpenAICompatibleProvider } from "../../../sdk/packages/llms/src/providers/ai-sdk";
import { createHarnessServer } from "./server.mjs";

const server = await createHarnessServer({ port: 0 });

try {
	const config = {
		providerId: "openai-compatible",
		apiKey: "harness",
		baseUrl: `${server.origin}/v1`,
	};
	const model = {
		id: "harness/baseline",
		providerId: "openai-compatible",
		name: "harness/baseline",
	};
	const context = {
		provider: {
			id: "openai-compatible",
			name: "OpenAI Compatible",
			defaultModelId: model.id,
			models: [model],
		},
		model,
		config,
	} as GatewayProviderContext;
	const request = {
		providerId: "openai-compatible",
		modelId: model.id,
		messages: [
			{
				id: "msg_user",
				role: "user",
				content: [{ type: "text", text: "Stress the harness" }],
				createdAt: new Date(),
			},
		],
		tools: [
			{
				name: "run_commands",
				description: "Run safe commands",
				inputSchema: {
					type: "object",
					properties: {
						commands: { type: "array", items: { type: "string" } },
					},
					required: ["commands"],
				},
			},
		],
	} as GatewayStreamRequest;

	const provider = await createOpenAICompatibleProvider(config);
	const events: AgentModelEvent[] = [];
	for await (const event of await provider.stream(request, context)) {
		events.push(event);
	}

	const toolCall = events.find(
		(event) => event.type === "tool-call-delta" && event.input !== undefined,
	);
	const finish = events.find((event) => event.type === "finish");
	if (
		toolCall?.type !== "tool-call-delta" ||
		toolCall.toolName !== "run_commands" ||
		finish?.type !== "finish"
	) {
		throw new Error(
			`Real provider did not produce the expected tool call: ${JSON.stringify(events)}`,
		);
	}
	if (finish.reason !== "tool-calls") {
		throw new Error(
			`Real provider finished with ${finish.reason} instead of tool-calls`,
		);
	}

	process.stdout.write(
		`Provider smoke passed: ${toolCall.toolName}, finish=${finish.reason}\n`,
	);
} finally {
	await server.close();
}
