#!/usr/bin/env bun
/** Explicitly launched, loopback-only simulator service. Never imported by app code. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMobileFixtureHost } from "../../scripts/dev-hub";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { startHubWebSocketServer, createLocalHubScheduleRuntimeHandlers } =
	await import(resolve(root, "sdk/packages/core/src/hub/index.ts"));
const { ScriptedRuntimeHost } = await import(
	resolve(root, "sdk/packages/hub-testkit/src/scripted-runtime-host.ts")
);
const { HubClient } = await import(
	resolve(root, "sdk/packages/hub-client/src/index.ts")
);
const MobileFixtureHost = createMobileFixtureHost(ScriptedRuntimeHost);
const stateDir =
	process.env.FIXTURE_STATE_DIR ||
	mkdtempSync(resolve(tmpdir(), "cline-native-fixture-"));
const port = Number(process.env.FIXTURE_PORT || 4783);
const base = `http://127.0.0.1:${port}`;
const token = "cline-isolated-native-fixture-token";
const controlKey = crypto.randomUUID();
const events: unknown[] = [];
const record = (kind: string, detail: unknown) => {
	events.push({ at: Date.now(), kind, detail });
	writeFileSync(
		resolve(stateDir, "events.json"),
		JSON.stringify(events, null, 2),
	);
};
const patch =
	"*** Begin Patch\n*** Update File: src/Fixture.ts\n@@\n-export const title = 'Before';\n+export const title = 'After';\n*** Add File: src/NewFixture.ts\n+export const nativeFixture = true;\n*** End Patch";

function fixtureTone() {
	const count = 40000,
		bytes = Buffer.alloc(44 + count * 2);
	bytes.write("RIFF", 0);
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WAVEfmt ", 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write("data", 36);
	bytes.writeUInt32LE(count * 2, 40);
	for (let index = 0; index < count; index++)
		bytes.writeInt16LE(
			Math.round(Math.sin((index * 2 * Math.PI * 440) / 8000) * 4000),
			44 + index * 2,
		);
	return bytes;
}
class NativeFixtureHost extends MobileFixtureHost {
	thinkingChoices = new Map<string, boolean>();
	async updateSessionConnection(
		sessionId: string,
		updates: {
			providerId?: string;
			modelId?: string;
			reasoningEffort?: string | null;
			thinking?: boolean | null;
		},
	) {
		if (typeof updates.thinking === "boolean")
			this.thinkingChoices.set(sessionId, updates.thinking);
		await super.updateSessionConnection(sessionId, updates);
	}
	async listModelCatalog() {
		const catalog = await super.listModelCatalog();
		return {
			...catalog,
			modelsByProvider: Object.fromEntries(
				Object.entries(catalog.modelsByProvider).map(([provider, models]) => [
					provider,
					models.map((model) => ({ ...model, supportsThinking: true })),
				]),
			),
		};
	}
	async getSession(sessionId: string) {
		const session = await super.getSession(sessionId);
		if (!session || typeof session !== "object") return session;
		const record = session as Record<string, unknown>;
		return {
			...record,
			metadata: {
				...(record.metadata as Record<string, unknown> | undefined),
				mode: record.mode ?? "act",
				thinking: this.thinkingChoices.get(sessionId) ?? false,
				...(typeof record.reasoningEffort === "string"
					? { reasoningEffort: record.reasoningEffort }
					: {}),
			},
		};
	}
	uxHistory = new Map<string, unknown[]>();
	extraListeners = new Set<(event: unknown) => void>();
	mediaHistory = new Map<string, { index: number; media: unknown }[]>();
	messageBase = new Map<string, number>();
	subscribe(listener: (event: unknown) => void) {
		const wrapped = (event: any) => {
			if (
				event.type === "agent_event" &&
				event.payload.event.type === "content_end" &&
				event.payload.event.contentType === "media"
			) {
				const sessionId = event.payload.sessionId;
				const history = this.mediaHistory.get(sessionId) || [];
				const media = event.payload.event.media;
				if (!history.some((entry: any) => entry.media.id === media.id))
					history.push({
						index: (this.messageBase.get(sessionId) || 0) + 1,
						media,
					});
				this.mediaHistory.set(sessionId, history);
			}
			listener(event);
		};
		this.extraListeners.add(wrapped);
		const unsubscribe = super.subscribe(wrapped);
		return () => {
			this.extraListeners.delete(wrapped);
			unsubscribe();
		};
	}
	emitExtra(sessionId: string, event: unknown) {
		for (const listener of this.extraListeners)
			listener({ type: "agent_event", payload: { sessionId, event } });
	}
	async readSessionMessages(sessionId: string) {
		const messages =
			await ScriptedRuntimeHost.prototype.readSessionMessages.call(
				this,
				sessionId,
			);
		const result: unknown[] = [];
		for (let index = 0; index <= messages.length; index++) {
			for (const entry of this.mediaHistory.get(sessionId) || [])
				if (entry.index === index)
					result.push({
						role: "assistant",
						content: [{ type: "media", media: entry.media }],
					});
			if (index < messages.length) result.push(messages[index]);
		}
		return [...(this.uxHistory.get(sessionId) ?? []), ...result];
	}
	async runTurn(input: { sessionId: string; prompt: string }) {
		this.messageBase.set(
			input.sessionId,
			(
				await ScriptedRuntimeHost.prototype.readSessionMessages.call(
					this,
					input.sessionId,
				)
			).length,
		);
		record("prompt", input);
		const prompt = input.prompt.toLowerCase();
		if (prompt.includes("ux-fixture")) {
			const notice =
				"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>";
			const history: unknown[] = [
				{
					role: "user",
					content: "INTERNAL_COMPACTION_CONTEXT_DO_NOT_DISPLAY",
					metadata: {
						kind: "compaction_summary",
						displayRole: "system",
						userRunSpan: 3,
					},
				},
				{
					role: "user",
					content: "INTERNAL_RECOVERY_CONTEXT_DO_NOT_DISPLAY",
					metadata: { kind: "recovery_notice" },
				},
				{
					role: "assistant",
					content: "INTERNAL_STATUS_CONTEXT_DO_NOT_DISPLAY",
					metadata: { displayRole: "status", displayOnly: true },
				},
				{
					role: "user",
					content:
						'<hook_context source="RunStart">\nINTERNAL_HOOK_CONTEXT_DO_NOT_DISPLAY\n</hook_context>',
				},
				{
					role: "user",
					content:
						'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
				},
				{
					role: "user",
					content: `${notice}<user_input mode="act">${notice}UX_VISIBLE_PROMPT Keep task_id and <div>my code</div>.\n\n\`\`\`xml\n<mode_notice>Authored XML example</mode_notice>\n\`\`\`</user_input>`,
				},
				{
					role: "assistant",
					content:
						"UX_VISIBLE_ANSWER keeps **Markdown** and literal XML: `<user_input>authored assistant example</user_input>`.",
				},
			];
			for (let index = 1; index <= 30; index += 1) {
				const number = String(index).padStart(2, "0");
				history.push(
					{
						role: "user",
						content: `<user_input mode="act">UX navigation prompt ${number}: inspect this section</user_input>`,
					},
					{
						role: "assistant",
						content: `UX answer ${number}: a deterministic transcript section for navigation.`,
					},
				);
			}
			this.uxHistory.set(input.sessionId, history);
			this.enqueue({
				steps: [
					{
						kind: "text",
						chunks: [
							"UX_FIXTURE_READY: reopen this conversation to load the seeded history.",
						],
					},
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("fixture-error"))
			throw new Error("Native fixture requested a deterministic run failure.");
		if (prompt.includes("edit-fixture")) {
			this.enqueue({
				steps: [
					{
						kind: "tool",
						name: "apply_patch",
						input: { input: patch },
						output:
							"Updated two synthetic files; no filesystem changes were made.",
						requiresApproval: false,
					},
					{ kind: "text", chunks: ["EDIT_FIXTURE_COMPLETE"] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("hold-fixture")) {
			this.enqueue({
				steps: [
					{ kind: "text", chunks: ["QUEUE_FIXTURE_HOLDING"] },
					{ kind: "gate", id: "native-queue" },
					{ kind: "text", chunks: ["QUEUE_FIXTURE_RELEASED"] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}

		const kind = prompt.includes("sample-file")
			? "file"
			: prompt.includes("sample-video")
				? "video"
				: prompt.includes("sample-audio")
					? "audio"
					: prompt.includes("sample-image")
						? "image"
						: undefined;
		if (kind) {
			const videoPath = resolve(stateDir, "fixture-video.mp4");
			if (kind === "video" && !existsSync(videoPath))
				throw new Error(
					"Generate fixture-video.mp4 before the video scenario.",
				);
			const bytes =
				kind === "video"
					? readFileSync(videoPath)
					: kind === "image"
						? readFileSync(resolve(root, "apps/mobile/assets/icon.png"))
						: kind === "audio"
							? fixtureTone()
							: Buffer.from(
									"Cline native fixture: safe generated file contents.\n",
								);
			const mediaType = {
				image: "image/png",
				audio: "audio/wav",
				video: "video/mp4",
				file: "text/plain",
			}[kind];
			const name = {
				image: "fixture.png",
				audio: "fixture-tone.wav",
				video: "fixture-video.mp4",
				file: "fixture-result.txt",
			}[kind];
			this.emitExtra(input.sessionId, {
				type: "content_end",
				contentType: "media",
				media: {
					id: `native-${crypto.randomUUID()}`,
					modality: kind,
					mediaType,
					name,
					source: { type: "base64", data: bytes.toString("base64") },
				},
			});
			this.enqueue({
				steps: [
					{ kind: "text", chunks: [`${kind.toUpperCase()}_FIXTURE_READY`] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}

		return super.runTurn(input);
	}
}
const runtime = new NativeFixtureHost({
	workspaceRoot: "/native-fixture",
	providerId: "cline",
	modelId: "anthropic/claude-sonnet-4-6",
	approvals: "wait-for-respond",
});
const hub = await startHubWebSocketServer({
	host: "127.0.0.1",
	port: 0,
	pathname: "/hub",
	pairing: false,
	owner: {
		ownerId: "native-fixture",
		discoveryPath: resolve(stateDir, "discovery.json"),
	},
	sessionHost: runtime,
	runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	scheduleOptions: { dbPath: ":memory:" },
	eventLog: { dbPath: ":memory:" },
	runQueue: { dbPath: ":memory:" },
	sessionSearchOptions: { dbPath: ":memory:" },
	taskOptions: {
		dbPath: ":memory:",
		globalSpecsDir: resolve(stateDir, "tasks"),
		watchFiles: false,
	},
});
const observer = new HubClient({
	url: hub.url,
	authMode: "hub-subprotocol",
	credential: hub.authToken,
	clientId: "native-fixture-observer",
	clientType: "native-fixture",
});
await observer.connect();
observer.subscribe((event: unknown) => record("hub-event", event));
let approved = existsSync(resolve(stateDir, "authorized"));
let historyError = false;
let hydrateError = false;
let abortError = false;
const rows: Record<string, unknown>[] = [];
let nextWorkspaceId = 0;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const auth = (request: Request) =>
	request.headers.get("authorization") === `Bearer workos:${token}`;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request, server) {
		const url = new URL(request.url),
			path = url.pathname;
		if (path === "/health") return json({ ok: true, fixture: true, base });
		if (path.startsWith("/control/")) {
			if (request.headers.get("x-fixture-key") !== controlKey)
				return json({ error: "fixture control key required" }, 403);
			const action = path.slice(9);
			if (action === "release") runtime.releaseGate("native-queue");
			if (action === "archive" || action === "resume") {
				const row = url.searchParams.get("id")
					? rows.find((row) => row.id === url.searchParams.get("id"))
					: rows[0];
				if (!row) return json({ error: "No fixture workspace exists" }, 404);
				row.status = action === "archive" ? "stopped" : "running";
			}
			if (action === "history-error")
				historyError = url.searchParams.get("enabled") !== "0";
			if (action === "hydrate-error")
				hydrateError = url.searchParams.get("enabled") !== "0";
			if (action === "abort-error")
				abortError = url.searchParams.get("enabled") !== "0";
			if (action === "events") return json(events);
			return json({ ok: true, historyError, hydrateError, abortError });
		}
		if (path === "/verify") {
			approved = true;
			writeFileSync(
				resolve(stateDir, "authorized"),
				"fixture browser authorization completed\n",
			);
			return new Response(
				"<h1>Cline simulator fixture signed in</h1><p>Return to the Cline E2E app.</p>",
				{ headers: { "content-type": "text/html" } },
			);
		}
		if (path === "/user_management/authorize/device")
			return json({
				device_code: "fixture-device",
				user_code: "E2E-ONLY",
				verification_uri: `${base}/verify`,
				verification_uri_complete: `${base}/verify`,
				expires_in: 900,
				interval: 1,
			});
		if (path === "/user_management/authenticate")
			return approved
				? json({
						access_token: "fixture-workos",
						refresh_token: "fixture-workos-refresh",
						token_type: "Bearer",
					})
				: json({ error: "authorization_pending" }, 400);
		if (path === "/api/v1/auth/register" || path === "/api/v1/auth/refresh")
			return json({
				success: true,
				data: {
					accessToken: token,
					refreshToken: "fixture-refresh",
					tokenType: "Bearer",
					expiresAt: new Date(Date.now() + 86400000).toISOString(),
					userInfo: {
						subject: "fixture-user",
						email: "simulator@example.invalid",
						name: "Native Fixture",
						clineUserId: "fixture-account",
						accounts: [],
					},
				},
			});
		if (path === "/api/v1/ai/cline/models")
			return json({
				data: [
					{
						id: "anthropic/claude-sonnet-4-6",
						name: "Fixture Sonnet",
						supported_parameters: ["reasoning"],
						architecture: { input_modalities: ["text", "image"] },
					},
				],
			});
		if (path === "/api/v1/ai/cline/recommended-models")
			return json({
				recommended: [
					{ id: "anthropic/claude-sonnet-4-6", name: "Fixture Sonnet" },
				],
			});
		if (!auth(request))
			return json(
				{ success: false, error: "Isolated fixture identity required" },
				401,
			);
		if (path === "/api/v1/users/me")
			return json({ data: { organizations: [] } });
		if (path === "/api/v1/users/active-account") return json({ success: true });
		if (path === "/api/v1/integrations/github/repositories/1/branches")
			return json({ data: { items: [{ name: "main" }], nextToken: null } });
		if (path === "/api/v1/integrations/github/repositories") {
			if (url.searchParams.has("repository"))
				return json({ data: { items: [{ name: "main" }], nextToken: null } });
			return json({
				data: [
					{
						id: 1,
						name: "native-fixture",
						full_name: "fixture/native-fixture",
						html_url: "https://github.com/fixture/native-fixture",
						clone_url: "https://github.com/fixture/native-fixture.git",
						private: true,
						default_branch: "main",
					},
				],
			});
		}
		if (path === "/api/v1/session" && request.method === "GET")
			return historyError
				? json({ success: false, error: "Fixture history unavailable" }, 503)
				: json({ success: true, data: rows });
		if (path === "/api/v1/session" && request.method === "POST") {
			const body = await request.json();
			const id = `fixture-workspace-${String(++nextWorkspaceId).padStart(8, "0")}`;
			const taskId = `fixture-task-${String(nextWorkspaceId).padStart(8, "0")}`;
			rows.unshift({
				id,
				status: "running",
				sandboxType: "resumable",
				title: body.title || "Native fixture conversation",
				metadata: {
					taskId,
					modelId: body.modelId || "anthropic/claude-sonnet-4-6",
					sandboxType: "resumable",
				},
				repoContext: {
					repoUrl: body.repoUrl || "https://github.com/fixture/native-fixture",
					branch: body.branch || "main",
				},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
			record("workspace-created", { id, taskId });
			return json({
				success: true,
				data: { sessionId: id, status: "running" },
			});
		}
		const archive = path.match(/^\/api\/v1\/session\/([^/]+)\/history$/);
		if (archive) {
			const row = rows.find((row) => row.id === archive[1]);
			if (!row) return json({ error: "No fixture workspace exists" }, 404);
			const taskId = (row.metadata as { taskId: string }).taskId;
			return json({
				version: 1,
				messages: await runtime.readSessionMessages(taskId),
			});
		}
		const match = path.match(/^\/api\/v1\/session\/([^/]+)(?:\/(status))?$/);
		if (match) {
			const row = rows.find((row) => row.id === match[1]);
			if (!row)
				return json({ success: false, error: "Unknown fixture session" }, 404);
			if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				if (
					server.upgrade(request, {
						data: { pending: [], upstream: undefined },
					})
				)
					return;
				return json({ error: "upgrade failed" }, 400);
			}
			if (request.method === "DELETE") {
				rows.splice(rows.indexOf(row), 1);
				await ScriptedRuntimeHost.prototype.deleteSession.call(
					runtime,
					(row.metadata as { taskId: string }).taskId,
				);
				record("fixture-workspace-deleted", { id: row.id });
				return new Response(null, { status: 204 });
			}
			if (request.method === "PATCH") {
				Object.assign(row, await request.json());
				return json({ success: true, data: row });
			}
			if (match[2])
				return json({
					success: true,
					data: { sessionId: row.id, status: row.status },
				});
			return json({ success: true, data: row });
		}
		record("unhandled-http", {
			method: request.method,
			path,
			query: url.search,
		});
		return json({ error: `Fixture endpoint not implemented: ${path}` }, 404);
	},
	websocket: {
		open(socket) {
			const upstream = new WebSocket(hub.url, [
				`cline-hub-auth.${hub.authToken}`,
			]);
			socket.data.upstream = upstream;
			upstream.onopen = () => {
				for (const message of socket.data.pending) upstream.send(message);
				socket.data.pending = [];
			};
			upstream.onmessage = (event) =>
				socket.send(
					typeof event.data === "string"
						? event.data
						: new Uint8Array(event.data),
				);
			upstream.onclose = () => socket.close();
			upstream.onerror = () => socket.close(1011, "Fixture upstream failure");
		},
		message(socket, message) {
			const text =
				typeof message === "string"
					? message
					: new TextDecoder().decode(message);
			try {
				const frame = JSON.parse(text),
					envelope = frame.envelope;
				if (
					frame.kind === "command" &&
					envelope &&
					((hydrateError && envelope.command === "session.messages") ||
						(abortError && envelope.command === "run.abort"))
				) {
					socket.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								requestId: envelope.requestId,
								ok: false,
								error: {
									code: "fixture_failure",
									message: `Fixture rejected ${envelope.command}`,
								},
							},
						}),
					);
					record("injected-command-error", envelope.command);
					return;
				}
			} catch {}
			const upstream = socket.data.upstream;
			if (upstream?.readyState === WebSocket.OPEN) upstream.send(text);
			else socket.data.pending.push(text);
		},
		close(socket) {
			socket.data.upstream?.close();
		},
	},
});
const config = { base, port, stateDir, controlKey, token, hubUrl: hub.url };
writeFileSync(
	resolve(stateDir, "config.json"),
	JSON.stringify(config, null, 2),
	{ mode: 0o600 },
);
console.log(
	JSON.stringify({
		fixtureBase: base,
		stateDir,
		configPath: resolve(stateDir, "config.json"),
	}),
);
process.on("SIGTERM", async () => {
	server.stop(true);
	observer.close();
	await hub.close();
	process.exit(0);
});
