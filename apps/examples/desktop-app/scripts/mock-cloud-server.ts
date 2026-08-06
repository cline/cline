/**
 * Mock Cline Cloud server for developing/testing the desktop app's Cloud
 * Sessions feature without a real Cline account or GitHub integration.
 *
 * Implements the subset of the remote-session API the sidecar talks to:
 *   REST  GET    /api/v1/integrations/github/repositories
 *   REST  GET    /api/v1/ai/cline/models
 *   REST  GET    /api/v1/session
 *   REST  POST   /api/v1/session
 *   REST  PATCH  /api/v1/session/:id
 *   REST  DELETE /api/v1/session/:id
 *   REST  GET    /api/v1/session/:id/history
 *   WS         /api/v1/session/:id            (hub protocol sandbox proxy)
 *
 * Plus mock-only admin endpoints (no auth) to drive demo states:
 *   GET  /__mock/state
 *   POST /__mock/github   { "connected": boolean }
 *
 * Usage:
 *   bun run scripts/mock-cloud-server.ts            # port 8790
 *   CLINE_CLOUD_API_BASE_URL=http://127.0.0.1:8790 bun run dev:sidecar
 *
 * Prompts sent to a session run a scripted agent turn with streamed
 * reasoning/assistant deltas, tool calls, and usage updates. Prompts
 * containing "test" additionally raise a tool approval request.
 */

type JsonRecord = Record<string, unknown>;

const PORT = Number(process.env.MOCK_CLOUD_PORT ?? 8790);

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let githubConnected = process.env.MOCK_GITHUB_CONNECTED !== "false";

type RemoteSessionRecord = {
	id: string;
	title: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	expiredAt: string;
	organizationId: string | null;
	origin: string;
	metadata: { modelId: string };
	repoContext: { repoUrl: string };
};

type AgentRun = {
	cancelled: boolean;
	pendingApproval?: {
		approvalId: string;
		resolve: (approved: boolean) => void;
	};
};

type AgentSession = {
	sessionId: string;
	status: "idle" | "running";
	rawMessages: JsonRecord[];
	usage: { inputTokens: number; outputTokens: number; totalCost: number };
	run: AgentRun | null;
};

type Sandbox = {
	remoteSessionId: string;
	agent: AgentSession | null;
	sockets: Set<Bun.ServerWebSocket<SocketData>>;
};

type SocketData = { remoteSessionId: string };

const remoteSessions = new Map<string, RemoteSessionRecord>();
const sandboxes = new Map<string, Sandbox>();

function getSandbox(remoteSessionId: string): Sandbox {
	let sandbox = sandboxes.get(remoteSessionId);
	if (!sandbox) {
		sandbox = { remoteSessionId, agent: null, sockets: new Set() };
		sandboxes.set(remoteSessionId, sandbox);
	}
	return sandbox;
}

const REPOSITORIES = [
	{
		id: 101,
		name: "cline",
		full_name: "saoudrizwan/cline",
		html_url: "https://github.com/saoudrizwan/cline",
		clone_url: "https://github.com/saoudrizwan/cline.git",
		private: false,
	},
	{
		id: 102,
		name: "dev-portfolio",
		full_name: "saoudrizwan/dev-portfolio",
		html_url: "https://github.com/saoudrizwan/dev-portfolio",
		clone_url: "https://github.com/saoudrizwan/dev-portfolio.git",
		private: true,
	},
	{
		id: 103,
		name: "recipe-box",
		full_name: "saoudrizwan/recipe-box",
		html_url: "https://github.com/saoudrizwan/recipe-box",
		clone_url: "https://github.com/saoudrizwan/recipe-box.git",
		private: true,
	},
];

const MODELS = [
	{
		id: "anthropic/claude-sonnet-4.6",
		displayName: "Claude Sonnet 4.6",
		description: "Best balance of intelligence and speed for agentic coding",
		tags: ["recommended"],
	},
	{
		id: "anthropic/claude-opus-4.6",
		displayName: "Claude Opus 4.6",
		description: "Most capable model for complex, multi-step tasks",
		tags: [],
	},
	{
		id: "openai/gpt-5.2",
		displayName: "GPT-5.2",
		description: "OpenAI's flagship coding model",
		tags: [],
	},
	{
		id: "x-ai/grok-code-fast-1",
		displayName: "Grok Code Fast 1",
		description: "Fast, economical model for everyday edits",
		tags: ["fast"],
	},
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function envelope(data: unknown, status = 200): Response {
	return json({ success: true, data, error: "" }, status);
}

function apiError(message: string, status: number): Response {
	return json({ success: false, data: "", error: message }, status);
}

function randomId(prefix: string): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(sandbox: Sandbox, event: string, payload: JsonRecord): void {
	const frame = JSON.stringify({
		kind: "event",
		envelope: {
			version: "v1",
			event,
			sessionId: sandbox.agent?.sessionId,
			payload,
		},
	});
	for (const socket of sandbox.sockets) {
		try {
			socket.send(frame);
		} catch {
			// Socket already closed.
		}
	}
}

function reply(
	socket: Bun.ServerWebSocket<SocketData>,
	requestId: string,
	payload: JsonRecord,
): void {
	socket.send(
		JSON.stringify({
			kind: "reply",
			envelope: { version: "v1", requestId, ok: true, payload },
		}),
	);
}

// ---------------------------------------------------------------------------
// Scripted agent run
// ---------------------------------------------------------------------------

async function streamText(
	sandbox: Sandbox,
	run: AgentRun,
	event: "assistant.delta" | "reasoning.delta",
	text: string,
	msPerChunk = 24,
): Promise<void> {
	const words = text.split(/(?<= )/);
	for (const word of words) {
		if (run.cancelled) return;
		broadcast(sandbox, event, { text: word });
		await sleep(msPerChunk);
	}
}

async function runTool(
	sandbox: Sandbox,
	run: AgentRun,
	toolName: string,
	input: JsonRecord,
	output: string,
	durationMs = 700,
): Promise<{ toolCallId: string }> {
	const toolCallId = randomId("toolu");
	broadcast(sandbox, "tool.started", { toolCallId, toolName, input });
	await sleep(durationMs);
	if (!run.cancelled) {
		broadcast(sandbox, "tool.finished", { toolCallId, toolName, output });
	}
	return { toolCallId };
}

function bumpUsage(
	sandbox: Sandbox,
	input: number,
	output: number,
	cost: number,
): void {
	const agent = sandbox.agent;
	if (!agent) return;
	agent.usage.inputTokens += input;
	agent.usage.outputTokens += output;
	agent.usage.totalCost += cost;
	broadcast(sandbox, "usage.updated", { totals: { ...agent.usage } });
}

async function simulateRun(sandbox: Sandbox, prompt: string): Promise<void> {
	const agent = sandbox.agent;
	if (!agent) return;
	const run: AgentRun = { cancelled: false };
	agent.run = run;
	agent.status = "running";
	agent.rawMessages.push({
		id: randomId("msg"),
		role: "user",
		content: prompt,
	});

	broadcast(sandbox, "run.started", {});
	await sleep(300);

	const assistantBlocks: JsonRecord[] = [];
	const toolResults: JsonRecord[] = [];
	const finish = (status: "completed" | "aborted") => {
		if (assistantBlocks.length > 0) {
			agent.rawMessages.push({
				id: randomId("msg"),
				role: "assistant",
				content: assistantBlocks,
			});
		}
		if (toolResults.length > 0) {
			agent.rawMessages.push({
				id: randomId("msg"),
				role: "user",
				content: toolResults,
			});
		}
		agent.status = "idle";
		agent.run = null;
		broadcast(
			sandbox,
			status === "completed" ? "run.completed" : "run.aborted",
			{},
		);
	};
	const recordTool = (
		toolCallId: string,
		toolName: string,
		input: JsonRecord,
		output: string,
	) => {
		assistantBlocks.push({
			type: "tool_use",
			id: toolCallId,
			name: toolName,
			input,
		});
		toolResults.push({
			type: "tool_result",
			tool_use_id: toolCallId,
			content: output,
		});
	};

	await streamText(
		sandbox,
		run,
		"reasoning.delta",
		"The user wants me to work on their repository. Let me start by exploring the project structure to understand the codebase before making changes.",
		14,
	);
	if (run.cancelled) return finish("aborted");

	const intro =
		"I'll start by exploring the repository to understand its structure.";
	await streamText(sandbox, run, "assistant.delta", intro);
	if (run.cancelled) return finish("aborted");
	broadcast(sandbox, "assistant.finished", { text: intro });
	assistantBlocks.push({ type: "text", text: intro });
	bumpUsage(sandbox, 2_113, 74, 0.011);

	const ls = await runTool(
		sandbox,
		run,
		"bash",
		{ command: "ls -la" },
		"README.md\npackage.json\nsrc/\ncomponents/\npublic/\nnext.config.mjs",
	);
	recordTool(
		ls.toolCallId,
		"bash",
		{ command: "ls -la" },
		"README.md\npackage.json\nsrc/\ncomponents/\npublic/\nnext.config.mjs",
	);
	if (run.cancelled) return finish("aborted");

	const read = await runTool(
		sandbox,
		run,
		"read_file",
		{ path: "components/navbar.tsx" },
		"export function Navbar() { /* 84 lines */ }",
		900,
	);
	recordTool(
		read.toolCallId,
		"read_file",
		{ path: "components/navbar.tsx" },
		"export function Navbar() { /* 84 lines */ }",
	);
	if (run.cancelled) return finish("aborted");

	const plan =
		"The navbar renders a static theme. I'll add a dark-mode toggle backed by `localStorage` and the `prefers-color-scheme` media query, then wire it into the navbar.";
	await streamText(sandbox, run, "assistant.delta", plan);
	if (run.cancelled) return finish("aborted");
	broadcast(sandbox, "assistant.finished", { text: plan });
	assistantBlocks.push({ type: "text", text: plan });
	bumpUsage(sandbox, 5_842, 210, 0.028);

	const edit = await runTool(
		sandbox,
		run,
		"edit_file",
		{ path: "components/navbar.tsx" },
		"Applied 2 edits: added ThemeToggle import and rendered it in the actions slot.",
		1_100,
	);
	recordTool(
		edit.toolCallId,
		"edit_file",
		{ path: "components/navbar.tsx" },
		"Applied 2 edits: added ThemeToggle import and rendered it in the actions slot.",
	);
	if (run.cancelled) return finish("aborted");

	// Prompts that mention tests exercise the approval flow.
	if (/\btests?\b/i.test(prompt)) {
		const approvalId = randomId("approval");
		const approved = await new Promise<boolean>((resolve) => {
			run.pendingApproval = { approvalId, resolve };
			broadcast(sandbox, "approval.requested", {
				approvalId,
				toolCallId: randomId("toolu"),
				toolName: "bash",
				input: { command: "bun test" },
			});
			// Auto-approve so an unattended run never wedges the mock.
			setTimeout(() => resolve(true), 120_000);
		});
		run.pendingApproval = undefined;
		broadcast(sandbox, "approval.resolved", { approvalId });
		if (run.cancelled) return finish("aborted");
		if (approved) {
			const test = await runTool(
				sandbox,
				run,
				"bash",
				{ command: "bun test" },
				"12 pass, 0 fail (18 expect() calls) Ran 12 tests in 431ms",
				1_400,
			);
			recordTool(
				test.toolCallId,
				"bash",
				{ command: "bun test" },
				"12 pass, 0 fail (18 expect() calls) Ran 12 tests in 431ms",
			);
		}
	}
	if (run.cancelled) return finish("aborted");

	const summary =
		"Done! I added a `ThemeToggle` component that persists the preference to `localStorage`, falls back to the system color scheme, and renders in the navbar next to the profile menu. Let me know if you'd like the toggle styled differently.";
	await streamText(sandbox, run, "assistant.delta", summary);
	if (run.cancelled) return finish("aborted");
	broadcast(sandbox, "assistant.finished", { text: summary });
	assistantBlocks.push({ type: "text", text: summary });
	bumpUsage(sandbox, 9_301, 388, 0.047);

	finish("completed");
}

// ---------------------------------------------------------------------------
// WebSocket command handling
// ---------------------------------------------------------------------------

function handleHubCommand(
	socket: Bun.ServerWebSocket<SocketData>,
	envelopeIn: JsonRecord,
): void {
	const command = String(envelopeIn.command ?? "");
	const requestId = String(envelopeIn.requestId ?? "");
	const payload = (envelopeIn.payload ?? {}) as JsonRecord;
	const sandbox = getSandbox(socket.data.remoteSessionId);
	const agent = sandbox.agent;

	switch (command) {
		case "client.register":
			reply(socket, requestId, { registered: true });
			return;
		case "session.list":
			reply(socket, requestId, {
				sessions: agent
					? [
							{
								sessionId: agent.sessionId,
								status: agent.status,
								updatedAt: Date.now(),
							},
						]
					: [],
			});
			return;
		case "session.get":
			reply(socket, requestId, {
				session: agent
					? {
							sessionId: agent.sessionId,
							status: agent.status,
							aggregateUsage: { ...agent.usage },
						}
					: null,
			});
			return;
		case "session.messages":
			reply(socket, requestId, { messages: agent?.rawMessages ?? [] });
			return;
		case "session.create": {
			const created: AgentSession = {
				sessionId: randomId("agent"),
				status: "idle",
				rawMessages: [],
				usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
				run: null,
			};
			sandbox.agent = created;
			reply(socket, requestId, { session: { sessionId: created.sessionId } });
			return;
		}
		case "session.send_input": {
			const prompt = String(payload.prompt ?? "");
			void simulateRun(sandbox, prompt).then(() => {
				reply(socket, requestId, { done: true });
			});
			return;
		}
		case "run.abort": {
			if (agent?.run) {
				agent.run.cancelled = true;
				agent.run.pendingApproval?.resolve(false);
			}
			reply(socket, requestId, { aborted: true });
			return;
		}
		case "approval.respond": {
			const approvalId = String(payload.approvalId ?? "");
			const pending = agent?.run?.pendingApproval;
			if (pending && pending.approvalId === approvalId) {
				pending.resolve(payload.approved === true);
			}
			reply(socket, requestId, { responded: true });
			return;
		}
		default:
			socket.send(
				JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId,
						ok: false,
						error: { code: "unsupported", message: `unsupported: ${command}` },
					},
				}),
			);
	}
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = Bun.serve<SocketData, string>({
	port: PORT,
	async fetch(request, srv) {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/$/, "");
		const method = request.method.toUpperCase();

		// Mock admin endpoints (no auth).
		if (path === "/__mock/state") {
			return json({
				githubConnected,
				sessions: [...remoteSessions.values()],
			});
		}
		if (path === "/__mock/github" && method === "POST") {
			const body = (await request.json().catch(() => ({}))) as JsonRecord;
			githubConnected = body.connected === true;
			return json({ githubConnected });
		}

		if (!request.headers.get("authorization")) {
			return apiError("unauthorized", 401);
		}

		// WebSocket upgrade: /api/v1/session/:id
		const wsMatch = path.match(/^\/api\/v1\/session\/([^/]+)$/);
		if (
			wsMatch &&
			request.headers.get("upgrade")?.toLowerCase() === "websocket"
		) {
			const remoteSessionId = decodeURIComponent(wsMatch[1]);
			if (!remoteSessions.has(remoteSessionId)) {
				return apiError("session not found", 404);
			}
			if (srv.upgrade(request, { data: { remoteSessionId } })) {
				return undefined as unknown as Response;
			}
			return apiError("upgrade failed", 400);
		}

		if (
			path === "/api/v1/integrations/github/repositories" ||
			/^\/api\/v1\/organizations\/[^/]+\/integrations\/github\/repositories$/.test(
				path,
			)
		) {
			if (!githubConnected) {
				return apiError("github integration not connected", 404);
			}
			return envelope(REPOSITORIES);
		}

		if (path === "/api/v1/ai/cline/models") {
			return envelope(MODELS);
		}

		if (path === "/api/v1/session" && method === "GET") {
			return envelope(
				[...remoteSessions.values()].sort((a, b) =>
					b.updatedAt.localeCompare(a.updatedAt),
				),
			);
		}

		if (path === "/api/v1/session" && method === "POST") {
			if (!githubConnected) {
				return apiError(
					"GitHub is not connected for this account; connect it under Integrations first",
					412,
				);
			}
			const body = (await request.json().catch(() => ({}))) as JsonRecord;
			const now = new Date();
			const record: RemoteSessionRecord = {
				id: randomId("rs"),
				title: String(body.title ?? "Untitled session"),
				status: "active",
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				expiredAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
				organizationId: body.organizationId
					? String(body.organizationId)
					: null,
				origin: "desktop",
				metadata: { modelId: String(body.modelId ?? "") },
				repoContext: { repoUrl: String(body.repoUrl ?? "") },
			};
			remoteSessions.set(record.id, record);
			// Simulate sandbox provisioning latency.
			await sleep(600);
			return envelope({
				sessionId: record.id,
				sandboxUrl: `http://127.0.0.1:${PORT}/api/v1/session/${record.id}`,
			});
		}

		const idMatch = path.match(/^\/api\/v1\/session\/([^/]+)(\/history)?$/);
		if (idMatch) {
			const sessionId = decodeURIComponent(idMatch[1]);
			const record = remoteSessions.get(sessionId);
			if (idMatch[2] === "/history" && method === "GET") {
				const sandbox = sandboxes.get(sessionId);
				if (!record && !sandbox) {
					return new Response("not found", { status: 404 });
				}
				return json({
					version: 1,
					messages: sandbox?.agent?.rawMessages ?? [],
				});
			}
			if (!record) {
				return apiError("session not found", 404);
			}
			if (method === "PATCH") {
				const body = (await request.json().catch(() => ({}))) as JsonRecord;
				if (typeof body.title === "string" && body.title.trim()) {
					record.title = body.title.trim();
				}
				record.updatedAt = new Date().toISOString();
				return envelope(record);
			}
			if (method === "DELETE") {
				remoteSessions.delete(sessionId);
				sandboxes.delete(sessionId);
				return envelope({ deleted: true });
			}
		}

		return apiError(`no mock route for ${method} ${path}`, 404);
	},
	websocket: {
		open(socket) {
			getSandbox(socket.data.remoteSessionId).sockets.add(socket);
		},
		close(socket) {
			sandboxes.get(socket.data.remoteSessionId)?.sockets.delete(socket);
		},
		message(socket, raw) {
			let frame: JsonRecord;
			try {
				frame = JSON.parse(String(raw)) as JsonRecord;
			} catch {
				return;
			}
			if (
				frame.kind === "command" &&
				frame.envelope &&
				typeof frame.envelope === "object"
			) {
				handleHubCommand(socket, frame.envelope as JsonRecord);
			}
			// stream.subscribe needs no reply.
		},
	},
});

console.log(
	`[mock-cloud] listening on http://127.0.0.1:${server.port} (githubConnected=${githubConnected})`,
);
