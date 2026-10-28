#!/usr/bin/env bun
/** Isolated SDK contract harness; never a native UI or real model execution pass. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createSessionState,
	reduceSession,
	selectViewModel,
} from "../../src/session/reducer";
import { parseSessionMessagesReply } from "../../src/session/schemas";
import { buildTranscriptWork } from "../../src/screens/chat/transcript-work";
import { SDK_FILE_TEXT } from "./sdk-contract-profiles";
const config = JSON.parse(
	readFileSync(process.env.FIXTURE_CONFIG_PATH!, "utf8"),
);
if (config.port !== 4796 && process.env.FIXTURE_ALLOW_OTHER_PORT !== "1")
	throw new Error(
		"Use isolated port4796 or explicit FIXTURE_ALLOW_OTHER_PORT=1.",
	);
const { HubClient } = await import(
	resolve(import.meta.dir, "../../../../sdk/packages/hub-client/src/index.ts")
);
const headers = {
	Authorization: `Bearer workos:${config.token}`,
	"Content-Type": "application/json",
};
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
async function wait(
	predicate: () => boolean | Promise<boolean>,
	message: string,
) {
	const end = Date.now() + 5000;
	while (!(await predicate())) {
		if (Date.now() > end) throw new Error(message);
		await new Promise((done) => setTimeout(done, 15));
	}
}
async function control(action: string, id: string) {
	const response = await fetch(
		`${config.base}/control/${action}?id=${encodeURIComponent(id)}`,
		{ headers: { "x-fixture-key": config.controlKey } },
	);
	assert(response.ok, `Scoped ${action} failed (${response.status})`);
	return response.json();
}
class HeaderWebSocket extends WebSocket {
	constructor(
		url: string,
		protocols: unknown,
		options: Record<string, unknown>,
	) {
		super(url, { ...options, protocols } as any);
	}
}
const clients: any[] = [],
	workspaces: string[] = [];
async function connect(workspace: string, sessionId?: string) {
	const client = new HubClient({
		WebSocketImpl: HeaderWebSocket as any,
		url: `${config.base.replace("http:", "ws:")}/api/v1/session/${workspace}`,
		authMode: "bearer-header",
		credential: `workos:${config.token}`,
		clientId: `sdk-check-${crypto.randomUUID()}`,
	});
	clients.push(client);
	await client.connect();
	const events: any[] = [];
	client.subscribe((event: unknown) => events.push(event));
	if (sessionId)
		await client.command("session.attach", { sessionId }, sessionId);
	return { client, events };
}
function project(messages: unknown[]) {
	const parsed = parseSessionMessagesReply({ messages });
	if (parsed.status !== "ok") throw new Error("Invalid SDK history");
	return selectViewModel(
		reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
			runStatus: "completed",
		}),
	);
}
const hasBlock = (messages: any[], type: string) =>
	messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some((block: any) => block.type === type),
	);
try {
	for (const profile of ["sdk-boundary-fixture", "sdk-work-fixture"]) {
		const response = await fetch(`${config.base}/api/v1/session`, {
			method: "POST",
			headers,
			body: JSON.stringify({ title: `SDK contract ${profile}` }),
		});
		assert(response.ok, "Workspace creation failed");
		const { data } = await response.json(),
			workspace = data.sessionId;
		workspaces.push(workspace);
		const detail = await (
				await fetch(`${config.base}/api/v1/session/${workspace}`, { headers })
			).json(),
			sessionId = detail.data.metadata.taskId;
		let active = await connect(workspace);
		await active.client.command("session.create", {
			sessionConfig: {
				sessionId,
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-6",
				workspaceRoot: "/native-fixture",
			},
		});
		const sending = active.client
			.command("session.send_input", { sessionId, prompt: profile }, sessionId)
			.catch(() => undefined);
		await wait(
			async () =>
				(await control("sdk-profile", workspace)).phase ===
				"waiting-tool-result",
			"First gate never opened",
		);
		const before = (
			await active.client.command("session.messages", { sessionId }, sessionId)
		).payload.messages;
		assert(
			hasBlock(before, "tool_use") && !hasBlock(before, "tool_result"),
			"Tool call must persist before its result",
		);
		assert(
			before.every((message: any) => typeof message.ts === "number"),
			"Real codec ts missing",
		);
		for (const stream of ["stdout", "stderr"])
			assert(
				active.events.some(
					(event: any) =>
						event.event === "tool.updated" &&
						event.payload.update?.stream === stream &&
						typeof event.payload.update.chunk === "string",
				),
				`Nested ${stream} missing`,
			);
		const parsedBefore = parseSessionMessagesReply({ messages: before });
		if (parsedBefore.status !== "ok")
			throw new Error("SDK pending history failed validation");
		let liveState = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsedBefore.messages,
			runStatus: "running",
		});
		for (const envelope of active.events.filter(
			(event: any) => event.event === "tool.updated",
		))
			liveState = reduceSession(liveState, { type: "event", envelope });
		assert(
			selectViewModel(liveState)
				.messages.flatMap((message) => message.blocks)
				.some(
					(block) =>
						block.kind === "tool" &&
						typeof block.output === "string" &&
						block.output.includes("SDK_STDOUT") &&
						block.output.includes("SDK_STDERR"),
				),
			"Shipping reducer lost nested progress on hydrated pending tool",
		);
		if (profile === "sdk-work-fixture")
			for (const [path, content] of Object.entries(SDK_FILE_TEXT))
				assert(
					before.some((message: any) =>
						message.content?.some?.(
							(block: any) =>
								block.type === "file" &&
								block.path === path &&
								block.content === content,
						),
					),
					`UTF8 loader bytes changed: ${path}`,
				);
		active.client.close();
		await sending;
		active = await connect(workspace, sessionId);
		await control("sdk-release", workspace);
		if (profile === "sdk-work-fixture") {
			await wait(
				async () =>
					(await control("sdk-profile", workspace)).phase ===
					"waiting-second-tool-result",
				"Second gate never opened",
			);
			const middle = (
				await active.client.command(
					"session.messages",
					{ sessionId },
					sessionId,
				)
			).payload.messages;
			assert(
				hasBlock(middle, "tool_result"),
				"First iteration result missing at second gate",
			);
			await control("sdk-release", workspace);
		}
		await wait(
			() => active.events.some((event: any) => event.event === "run.completed"),
			"No completion after socket-only reconnect",
		);
		assert(
			active.events.some(
				(event: any) =>
					event.event === "tool.finished" &&
					event.payload.output?.includes?.("SDK_BUILD_RESULT"),
			),
			"No final live result for hydrated tool",
		);
		for (const envelope of active.events)
			liveState = reduceSession(liveState, { type: "event", envelope });
		assert(
			selectViewModel(liveState)
				.messages.flatMap((message) => message.blocks)
				.some(
					(block) =>
						block.kind === "tool" &&
						block.name === "run_command" &&
						block.state === "completed" &&
						block.output === "SDK_BUILD_RESULT: synthetic build succeeded.",
				),
			"Shipping reducer left the hydrated tool spinning after its live result",
		);
		const messages = (
			await active.client.command("session.messages", { sessionId }, sessionId)
		).payload.messages;
		const hydrated = project(messages),
			blocks = hydrated.messages.flatMap((message) => message.blocks);
		assert(
			blocks
				.filter((block) => block.kind === "tool")
				.every((block: any) => block.state === "completed"),
			"Persisted tools are not complete",
		);
		assert(
			hydrated.messages.every(
				(message) => typeof message.createdAt === "number",
			),
			"Shipping timestamp projection missing",
		);
		const rows = buildTranscriptWork(hydrated.messages, {
			runStatus: "completed",
		});
		assert(
			rows.some((row) => row.work),
			"Completed work grouping missing",
		);
		assert(
			rows.some((row) =>
				row.blocks.some(
					(block) =>
						block.kind === "text" &&
						/SDK_(CONTRACT|BOUNDARY)_FINAL/.test(block.text),
				),
			),
			"submit_and_exit input.summary missing",
		);
		if (profile === "sdk-work-fixture") {
			assert(
				messages.some(
					(message: any) =>
						message.metadata?.modelToolActivities?.[0]?.execution ===
							"provider" && message.content.length === 0,
				),
				"Metadata-only provider history missing",
			);
			assert(
				blocks.some(
					(block) =>
						block.kind === "tool" &&
						block.name === "web_search" &&
						block.output === "SDK_PROVIDER_SEARCH_RESULT",
				),
				"Shipping metadata activity missing",
			);
			for (const content of Object.values(SDK_FILE_TEXT))
				assert(
					blocks.some(
						(block) =>
							block.kind === "media" &&
							block.media.source.type === "base64" &&
							block.media.source.data ===
								Buffer.from(content, "utf8").toString("base64"),
					),
					"Shipping UTF8 file encoding changed authored bytes",
				);
		}
		console.log(
			`PASS ${profile}: SDK builder/codec/projector, persisted-before-result, nested stdout/stderr, socket reconnect, scoped gates, ts/provider/UTF8/summary projections`,
		);
	}
} finally {
	for (const client of clients) client.close();
	for (const workspace of workspaces)
		await fetch(`${config.base}/api/v1/session/${workspace}`, {
			method: "DELETE",
			headers,
		});
}
