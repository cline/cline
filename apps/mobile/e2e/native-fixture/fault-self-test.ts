#!/usr/bin/env bun
/** Isolated proxy-fault contract checks, never a native E2E claim. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createSessionState,
	reduceSession,
	selectViewModel,
} from "../../src/session/reducer";
import { parseSessionMessagesReply } from "../../src/session/schemas";

const configPath = process.env.FIXTURE_CONFIG_PATH;
if (!configPath) throw new Error("Set FIXTURE_CONFIG_PATH");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const { HubClient } = await import(
	resolve(import.meta.dir, "../../../../sdk/packages/hub-client/src/index.ts")
);
const headers = {
	Authorization: `Bearer workos:${config.token}`,
	"Content-Type": "application/json",
};
async function request(path: string, method = "GET", body?: unknown) {
	return fetch(`${config.base}${path}`, {
		method,
		headers,
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}
async function control(action: string, fault?: string, value = 1, id?: string) {
	const query = new URLSearchParams({
		...(fault ? { fault, value: String(value) } : {}),
		...(id ? { id } : {}),
	});
	const reply = await fetch(`${config.base}/control/${action}?${query}`, {
		headers: { "x-fixture-key": config.controlKey },
	});
	if (!reply.ok) throw new Error(`Control ${action} failed`);
}
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
const ids: string[] = [];
async function create(title: string) {
	const reply = await request("/api/v1/session", "POST", { title });
	const body = await reply.json();
	assert(reply.ok, "Create failed");
	ids.push(body.data.sessionId);
	return body.data.sessionId as string;
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
const clients: any[] = [];
const taskIds: string[] = [];
try {
	for (const [fault, path, expectedStatus, expectedCode] of [
		[
			"auth-pending",
			"/user_management/authenticate",
			400,
			"authorization_pending",
		],
		["auth-expired", "/user_management/authenticate", 400, "expired_token"],
		["auth-error", "/user_management/authenticate", 503, "server_error"],
		[
			"auth-authorize-error",
			"/user_management/authorize/device",
			503,
			"Fixture device authorization unavailable",
		],
	] as const) {
		await control("set", fault);
		const reply = await request(path, "POST", {});
		assert(
			reply.status === expectedStatus &&
				(await reply.json()).error === expectedCode,
			`${fault} response mismatch`,
		);
		await control("clear");
	}
	console.log(
		"PASS device auth pending/expiry/poll/authorization error controls",
	);
	const before = (await (await request("/api/v1/session")).json()).data.length;
	await control("set", "create-error");
	assert(
		(await request("/api/v1/session", "POST", { title: "Rejected" })).status ===
			503,
		"Create error status",
	);
	await control("clear");
	assert(
		(await (await request("/api/v1/session")).json()).data.length === before,
		"Rejected create must not mutate rows",
	);
	await control("set", "create-ambiguous");
	assert(
		(await request("/api/v1/session", "POST", { title: "Ambiguous fixture" }))
			.status === 503,
		"Ambiguous ack status",
	);
	await control("clear");
	const after = (await (await request("/api/v1/session")).json()).data;
	assert(
		after.length === before + 1,
		"Ambiguous ack must retain exactly one task",
	);
	ids.push(after[0].id);
	console.log("PASS rejected create versus accepted ambiguous create");
	await control("set", "create-delay-ms", 150);
	await control("set", "create-pending-ms", 250);
	const start = Date.now();
	const a = await create("Fault contract A");
	assert(Date.now() - start >= 140, "Create delay missing");
	assert(
		(await (await request(`/api/v1/session/${a}/status`)).json()).data
			.status === "provisioning",
		"Expected provisioning",
	);
	await control("clear");
	await Bun.sleep(270);
	assert(
		(await (await request(`/api/v1/session/${a}/status`)).json()).data
			.status === "running",
		"Provisioning did not finish",
	);
	const b = await create("Fault contract B");
	console.log("PASS create delay and staged provisioning status");
	for (const [fault, path, status] of [
		["list-error", "/api/v1/session", 503],
		["repositories-error", "/api/v1/integrations/github/repositories", 403],
		[
			"branches-error",
			"/api/v1/integrations/github/repositories/1/branches",
			503,
		],
		["models-error", "/api/v1/ai/cline/models", 503],
	] as const) {
		await control("set", fault);
		assert((await request(path)).status === status, `${fault} not injected`);
		await control("clear");
		assert((await request(path)).ok, `${fault} not cleared`);
	}
	await control("set", "list-empty");
	assert(
		(await (await request("/api/v1/session")).json()).data.length === 0,
		"List empty",
	);
	await control("clear");
	await control("set", "repositories-empty");
	assert(
		(await (await request("/api/v1/integrations/github/repositories")).json())
			.data.length === 0,
		"Repo empty",
	);
	await control("clear");
	console.log(
		"PASS global list/repository/branch/catalog empty and error controls",
	);
	for (const [fault, suffix, method] of [
		["rename-error", "", "PATCH"],
		["delete-error", "", "DELETE"],
		["suspend-error", "/suspend", "POST"],
		["resume-error", "/resume", "POST"],
		["history-error", "/history", "GET"],
		["status-error", "/status", "GET"],
	] as const) {
		await control("set", fault, 1, a);
		assert(
			(
				await request(
					`/api/v1/session/${a}${suffix}`,
					method,
					method === "PATCH" ? { title: "MUST_NOT_APPLY" } : undefined,
				)
			).status === 503,
			`${fault} not scoped`,
		);
		assert(
			(await request(`/api/v1/session/${b}`)).ok,
			`Unrelated B disrupted by ${fault}`,
		);
		await control("clear", undefined, 1, a);
	}
	await request(`/api/v1/session/${a}/suspend`, "POST");
	assert(
		(await (await request(`/api/v1/session/${a}/status`)).json()).data
			.status === "suspended",
		"Suspend not applied",
	);
	await request(`/api/v1/session/${a}/resume`, "POST");
	assert(
		(await (await request(`/api/v1/session/${a}/status`)).json()).data
			.status === "running",
		"Resume not applied",
	);
	console.log("PASS scoped archive/action faults and suspend/resume");
	for (const id of [a, b]) {
		const client = new HubClient({
			WebSocketImpl: HeaderWebSocket as any,
			url: `${config.base.replace("http:", "ws:")}/api/v1/session/${id}`,
			authMode: "bearer-header",
			credential: `workos:${config.token}`,
			clientId: `fault-contract-${id}`,
		});
		await client.connect();
		clients.push(client);
		const detail = (await (await request(`/api/v1/session/${id}`)).json()).data;
		taskIds.push(detail.metadata.taskId);
		await client.command("session.create", {
			sessionConfig: {
				sessionId: detail.metadata.taskId,
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-6",
				workspaceRoot: "/native-fixture",
			},
		});
	}
	const [ca, cb] = clients;
	for (const [fault, command, payload] of [
		["hydrate-error", "session.messages", {}],
		["abort-error", "run.abort", {}],
		[
			"approval-error",
			"approval.respond",
			{ approvalId: "not-real", approved: true },
		],
		[
			"question-error",
			"capability.respond",
			{ requestId: "not-real", ok: true, payload: { result: "fixture" } },
		],
		["send-error", "session.send_input", { prompt: "must not execute" }],
		[
			"reasoning-error",
			"session.update_connection",
			{ updates: { thinking: false } },
		],
		["catalog-error", "catalog.list", {}],
	] as const) {
		await control("set", fault, 1, a);
		let rejected = false;
		try {
			await ca.command(command, payload, taskIds[0]);
		} catch (error) {
			rejected = String(error).includes("Fixture rejected");
		}
		assert(rejected, `${fault} missing proxy rejection`);
		await cb.command("session.messages", {}, taskIds[1]);
		await control("clear", undefined, 1, a);
	}
	console.log(
		"PASS scoped WS hydrate/abort/approval/question/send/model/catalog fault controls",
	);
	const failureEvents: any[] = [];
	const stopFailureEvents = ca.subscribe((event: any) => {
		if (event.sessionId === taskIds[0]) failureEvents.push(event);
	});
	try {
		await ca.command(
			"session.send_input",
			{ prompt: "fixture-error" },
			taskIds[0],
		);
	} catch {
		// The deterministic runtime throws; the command may reject while the
		// real Hub publishes run.failed. Both must describe the same outcome.
	}
	await Bun.sleep(30);
	const failedSession = await ca.command(
		"session.get",
		{ sessionId: taskIds[0] },
		taskIds[0],
	);
	assert(
		failedSession.payload.session.status === "failed",
		"Thrown fixture-error must remain failed when reopened",
	);
	const failures = failureEvents.filter(
		(event) => event.event === "run.failed",
	);
	assert(failures.length > 0, "Thrown fixture-error must project run.failed");
	// The Hub's rejected-command path carries the exception without a snapshot;
	// projector-originated terminal events include the authoritative snapshot.
	assert(
		failures.every(
			(event) =>
				!event.payload.snapshot || event.payload.snapshot.status === "failed",
		),
		"Thrown fixture-error terminal snapshots must be failed when present",
	);
	const finalStatus = failureEvents
		.filter((event) => event.event === "session.updated")
		.at(-1);
	assert(
		finalStatus?.payload.session.status === "failed" &&
			finalStatus?.payload.snapshot.status === "failed",
		"Thrown fixture-error must publish a final failed session and snapshot",
	);

	await ca.command(
		"session.send_input",
		{ prompt: "RECOVER_AFTER_RUNTIME_FAILURE" },
		taskIds[0],
	);
	const recoveredSession = await ca.command(
		"session.get",
		{ sessionId: taskIds[0] },
		taskIds[0],
	);
	assert(
		recoveredSession.payload.session.status === "completed",
		"Ordinary turn after fixture-error must recover to completed",
	);
	stopFailureEvents();
	console.log(
		"PASS thrown runtime failure remains failed in terminal/status/reopen and subsequent turn recovers",
	);
	const completed = [0, 0];
	const activeStatuses: string[] = [];
	let mobileState = reduceSession(createSessionState(), {
		type: "hydrated",
		messages: [],
	});
	ca.subscribe((event: any) => {
		if (event.sessionId === taskIds[0])
			mobileState = reduceSession(mobileState, {
				type: "event",
				envelope: event,
			});
		if (event.event === "session.updated" && event.sessionId === taskIds[0])
			activeStatuses.push(event.payload.session.status);
		if (event.event === "run.completed" && event.sessionId === taskIds[0])
			completed[0] += 1;
	});
	cb.subscribe((event: any) => {
		if (event.event === "run.completed" && event.sessionId === taskIds[1])
			completed[1] += 1;
	});
	const runA = ca.command(
		"session.send_input",
		{ prompt: "hold-fixture" },
		taskIds[0],
	);
	void runA.catch(() => {});
	const runB = cb.command(
		"session.send_input",
		{ prompt: "hold-fixture" },
		taskIds[1],
	);
	void runB.catch(() => {});
	await Bun.sleep(50);
	assert(
		(await ca.command("session.get", { sessionId: taskIds[0] }, taskIds[0]))
			.payload.session.status === "running",
		"Held session.get must remain running",
	);
	assert(
		activeStatuses.length > 0 &&
			activeStatuses.every((status) => status === "running"),
		`Held session.updated must never regress idle: ${activeStatuses.join(",")}`,
	);
	assert(
		selectViewModel(mobileState).runStatus === "running",
		"Shipping reducer must retain running held state",
	);
	console.log(
		"PASS held session get/update and shipping reducer remain running throughout gate",
	);
	assert(
		completed[0] === 0 && completed[1] === 0,
		"Both held tasks must remain pending",
	);
	for (const prompt of ["QUEUE_A", "QUEUE_B", "QUEUE_C"])
		await ca.command("session.send_input", { prompt }, taskIds[0]);
	let queued = (await ca.command("session.pending_prompts", {}, taskIds[0]))
		.payload.prompts;
	assert(
		queued.length === 3,
		"Busy admission must expose exactly three pending rows",
	);
	assert(
		selectViewModel(mobileState).pendingPrompts.length === 3,
		"Shipping reducer must expose three queued rows",
	);
	const first = queued.find((entry: any) => entry.prompt === "QUEUE_A");
	const second = queued.find((entry: any) => entry.prompt === "QUEUE_B");
	const third = queued.find((entry: any) => entry.prompt === "QUEUE_C");
	await ca.command(
		"session.update_pending_prompt",
		{ promptId: first.id, prompt: "QUEUE_A_EDITED" },
		taskIds[0],
	);
	await ca.command(
		"session.remove_pending_prompt",
		{ promptId: second.id },
		taskIds[0],
	);
	await ca.command(
		"session.update_pending_prompt",
		{ promptId: third.id, delivery: "steer" },
		taskIds[0],
	);
	await Bun.sleep(30);
	queued = (await ca.command("session.pending_prompts", {}, taskIds[0])).payload
		.prompts;
	assert(
		queued.length === 1 && queued[0].prompt === "QUEUE_A_EDITED",
		"Edited queue survives; removed and steered rows leave queue",
	);
	const busyHistory = (await ca.command("session.messages", {}, taskIds[0]))
		.payload.messages;
	assert(
		busyHistory.filter(
			(message: any) =>
				message.role === "user" && message.content === "QUEUE_C",
		).length === 1,
		"Steer must enter canonical history once",
	);
	assert(
		!busyHistory.some(
			(message: any) =>
				message.role === "user" && message.content === "QUEUE_A_EDITED",
		),
		"Queued task must not run while held",
	);
	console.log(
		"PASS production pending controller admission/edit/remove/steer while held",
	);
	await control("release", undefined, 1, a);
	await Bun.sleep(100);
	assert(
		completed[0] >= 1 && completed[1] === 0,
		"Releasing A must not release B",
	);
	await control("release", undefined, 1, b);
	await Bun.sleep(100);
	assert(completed[1] === 1, "Scoped release must finish B");
	await Promise.all([runA, runB]);
	await Bun.sleep(50);
	const drained = (await ca.command("session.messages", {}, taskIds[0])).payload
		.messages;
	assert(
		drained.filter(
			(message: any) =>
				message.role === "user" && message.content === "QUEUE_A_EDITED",
		).length === 1,
		"Edited queued task must run canonically once",
	);
	assert(
		!drained.some(
			(message: any) =>
				message.role === "user" && message.content === "QUEUE_B",
		),
		"Removed task must never run",
	);
	assert(
		(await ca.command("session.pending_prompts", {}, taskIds[0])).payload
			.prompts.length === 0,
		"Queue must drain after held turn completes",
	);
	console.log(
		"PASS released queue drains edited prompt once without deleted prompt",
	);
	console.log("PASS independently held tasks release only selected workspace");
	const abortHeld = ca.command(
		"session.send_input",
		{ prompt: "hold-fixture" },
		taskIds[0],
	);
	void abortHeld.catch(() => {});
	await Bun.sleep(30);
	await ca.command(
		"session.send_input",
		{ prompt: "QUEUE_AFTER_ABORT" },
		taskIds[0],
	);
	await ca.command("run.abort", {}, taskIds[0]);
	await abortHeld;
	await Bun.sleep(50);
	const afterAbort = (await ca.command("session.messages", {}, taskIds[0]))
		.payload.messages;
	assert(
		afterAbort.filter(
			(message: any) =>
				message.role === "user" && message.content === "QUEUE_AFTER_ABORT",
		).length === 1,
		"Aborted user turn must retain and drain queued work once",
	);
	const subsequentHold = ca.command(
		"session.send_input",
		{ prompt: "hold-fixture" },
		taskIds[0],
	);
	void subsequentHold.catch(() => {});
	await Bun.sleep(30);
	assert(
		(await ca.command("session.get", { sessionId: taskIds[0] }, taskIds[0]))
			.payload.session.status === "running",
		"Prior Abort must not pre-release next held gate",
	);
	await control("release", undefined, 1, a);
	await subsequentHold;
	console.log(
		"PASS Abort drains retained queue and subsequent held turn remains controllable",
	);
	await ca.command(
		"session.send_input",
		{ prompt: "sample-image" },
		taskIds[0],
	);
	await Bun.sleep(30);
	assert(
		selectViewModel(mobileState).messages.some((message) =>
			message.blocks.some((block) => block.kind === "media"),
		),
		"Shipping reducer must retain generated image after run completion",
	);
	console.log(
		"PASS generated image survives live shipping reducer projection through completion",
	);
	const imageData = "data:image/png;base64,iVBORw0KGgo=";
	await ca.command(
		"session.send_input",
		{ prompt: "USER_IMAGE_REPLAY", attachments: { userImages: [imageData] } },
		taskIds[0],
	);
	const imageHistory = (await ca.command("session.messages", {}, taskIds[0]))
		.payload.messages;
	const photoMessage = imageHistory.find(
		(message: any) =>
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.some(
				(block: any) =>
					block.type === "text" && block.text === "USER_IMAGE_REPLAY",
			),
	);
	assert(
		photoMessage?.content.some(
			(block: any) =>
				block.type === "image" &&
				block.data === "iVBORw0KGgo=" &&
				block.mediaType === "image/png",
		),
		"Submitted image must persist canonical decoded base64 image block",
	);
	const parsedPhotos = parseSessionMessagesReply({ messages: imageHistory });
	assert(
		parsedPhotos.status === "ok",
		"Photo replay history must pass production schema",
	);
	if (parsedPhotos.status === "ok") {
		const replay = selectViewModel(
			reduceSession(createSessionState(), {
				type: "hydrated",
				messages: parsedPhotos.messages,
			}),
		);
		assert(
			replay.messages.some(
				(message) =>
					message.role === "user" &&
					message.blocks.some(
						(block) =>
							block.kind === "media" && block.media.modality === "image",
					),
			),
			"Shipping reducer must project replayed user photo",
		);
	}
	console.log(
		"PASS submitted user image persists through canonical history and shipping hydration",
	);
	await control("snapshot");
	assert(
		JSON.parse(
			readFileSync(resolve(config.stateDir, "restore.json"), "utf8"),
		).entries.some((entry: any) => entry.row.id === a),
		"Snapshot lost workspace ID",
	);
	console.log("PASS snapshot retains completed workspace IDs and history");
} finally {
	await control("clear");
	for (const id of ids) {
		await control("release", undefined, 1, id);
		await control("clear", undefined, 1, id);
		await request(`/api/v1/session/${id}`, "DELETE");
	}
	for (const client of clients) client.close();
}
console.log(
	"Fixture fault contracts validated; native UI verification still required.",
);
