#!/usr/bin/env bun
/** Validate fixture transport before native UI runs; not an E2E pass. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { HubClient } = await import(
	resolve(root, "sdk/packages/hub-client/src/index.ts")
);
const base = process.env.FIXTURE_BASE_URL || "http://127.0.0.1:4783";
const headers = {
	Authorization: "Bearer workos:cline-isolated-native-fixture-token",
	"Content-Type": "application/json",
};
const response = await fetch(`${base}/api/v1/session`, {
	method: "POST",
	headers,
	body: JSON.stringify({
		title: "Protocol fixture self-test",
		modelId: "anthropic/claude-sonnet-4-6",
		repoUrl: "https://github.com/fixture/native-fixture",
		branch: "main",
	}),
});
if (!response.ok) throw new Error(`REST create failed: ${response.status}`);
const { data } = await response.json();
const detail = await (
	await fetch(`${base}/api/v1/session/${data.sessionId}`, { headers })
).json();
class HeaderWebSocket extends WebSocket {
	constructor(
		url: string,
		protocols: unknown,
		options: Record<string, unknown>,
	) {
		super(url, { ...options, protocols } as any);
	}
}
const client = new HubClient({
	WebSocketImpl: HeaderWebSocket as any,
	url: `${base.replace("http:", "ws:")}/api/v1/session/${data.sessionId}`,
	authMode: "bearer-header",
	credential: "workos:cline-isolated-native-fixture-token",
	clientId: `fixture-self-test-${Date.now()}`,
});
await client.connect();
const seen: any[] = [];
client.subscribe((event: any) => {
	seen.push(event);
	if (event.event === "capability.requested")
		void client.command(
			"capability.respond",
			{
				requestId: event.payload.requestId,
				ok: true,
				payload: { result: "Use the existing design" },
			},
			event.sessionId,
		);
	if (event.event === "approval.requested")
		void client.command(
			"approval.respond",
			{ approvalId: event.payload.approvalId, approved: true },
			event.sessionId,
		);
});
const created = await client.command("session.create", {
	sessionConfig: {
		sessionId: detail.data.metadata.taskId,
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4-6",
		workspaceRoot: "/native-fixture",
		enableTools: true,
	},
	runtimeOptions: {
		clientContributions: [
			{
				kind: "toolExecutor",
				executor: "askQuestion",
				capabilityName: "tool_executor.askQuestion",
			},
		],
	},
});
const sessionId = created.payload.session.sessionId;
const catalog = (await client.command("catalog.list", {})).payload;
const initial = (await client.command("session.get", { sessionId }, sessionId))
	.payload.session;
if (
	initial.model !== "anthropic/claude-sonnet-4-6" ||
	initial.metadata?.thinking !== false ||
	!catalog.modelsByProvider.cline.some(
		(model: any) =>
			model.id === initial.model && model.supportsThinking === true,
	)
)
	throw new Error(
		"Fixture model must match REST catalog and advertise thinking capability with explicit Off metadata",
	);
console.log(
	"PASS consistent runtime model, thinking capability and default Off metadata",
);
await client.command(
	"session.update_connection",
	{
		sessionId,
		updates: {
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: null,
		},
	},
	sessionId,
);
const high = (await client.command("session.get", { sessionId }, sessionId))
	.payload.session;
if (
	high.metadata?.thinking !== true ||
	high.metadata?.reasoningEffort !== "high"
)
	throw new Error("Fixture did not persist thinking effort");
await client.command(
	"session.update_connection",
	{
		sessionId,
		updates: {
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		},
	},
	sessionId,
);
const off = (await client.command("session.get", { sessionId }, sessionId))
	.payload.session;
if (off.metadata?.thinking !== false)
	throw new Error("Fixture did not persist thinking Off");
console.log("PASS thinking High and Off updates survive session hydration");
for (const prompt of [
	"ask-question",
	"approval-fixture",
	"edit-fixture",
	"sample-image",
	"sample-audio",
	"sample-video",
	"sample-file",
	"ux-fixture",
	"rich-fixture",
	"invalid-media",
]) {
	const completedBefore = seen.filter(
		(event) => event.event === "run.completed",
	).length;
	await client.command("session.send_input", { prompt }, sessionId);
	const deadline = Date.now() + 10000;
	while (
		seen.filter((event) => event.event === "run.completed").length ===
		completedBefore
	) {
		if (Date.now() > deadline) throw new Error(`Timed out: ${prompt}`);
		await Bun.sleep(20);
	}
	console.log(`PASS fixture protocol: ${prompt}`);
}
const media = seen
	.filter((event) => event.event === "assistant.media")
	.map((event) => event.payload.media.modality);
if (!["image", "audio", "video", "file"].every((kind) => media.includes(kind)))
	throw new Error(`Missing media: ${media.join(",")}`);
const historyReply = await client.command("session.messages", {}, sessionId);
const persistedMedia = historyReply.payload.messages
	.flatMap((message: any) =>
		Array.isArray(message.content) ? message.content : [],
	)
	.filter((block: any) => block.type === "media");
if (persistedMedia.length !== 7)
	throw new Error(
		`Expected seven persisted media blocks, got ${persistedMedia.length}`,
	);
const archive = await (
	await fetch(`${base}/api/v1/session/${data.sessionId}/history`, { headers })
).json();
if (
	archive.version !== 1 ||
	archive.messages.length !== historyReply.payload.messages.length
)
	throw new Error("Archive history did not match Hub transcript");
console.log("PASS fixture media hydration + archive history");
const uxHistory = historyReply.payload.messages;
if (
	!uxHistory.some(
		(message: any) => message.metadata?.displayRole === "system",
	) ||
	!uxHistory.some(
		(message: any) => message.metadata?.displayRole === "status",
	) ||
	!uxHistory.some(
		(message: any) =>
			typeof message.content === "string" &&
			message.content.includes("UX_VISIBLE_PROMPT"),
	) ||
	uxHistory.filter(
		(message: any) =>
			typeof message.content === "string" &&
			message.content.includes("UX navigation prompt "),
	).length !== 30
) {
	throw new Error(
		"UX fixture did not retain internal metadata, wrapped user content, and long navigation history",
	);
}
console.log("PASS UX metadata, wrapped copy and 30-prompt history fixtures");
client.close();
const deletion = await fetch(`${base}/api/v1/session/${data.sessionId}`, {
	method: "DELETE",
	headers,
});
if (deletion.status !== 204)
	throw new Error(`Fixture session delete failed: ${deletion.status}`);
const after = await (await fetch(`${base}/api/v1/session`, { headers })).json();
if (after.data.some((row: any) => row.id === data.sessionId))
	throw new Error("Deleted fixture session is still listed");
console.log("PASS disposable fixture session deletion");
console.log(
	"Fixture harness transport validated; native UI testing is still required.",
);
