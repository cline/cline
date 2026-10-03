import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ApiHandler,
	type ApiStreamChunk,
	registerHandler,
	type ToolDefinition,
} from "@cline/llms";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubServerTransport } from "./hub-server-transport";

const PROVIDER_ID = "hub-session-agent-config-test";
const DELEGATING_PROMPT = "You are a delegating parent session.";
const CHILD_PROMPT = "You are the spawned child agent.";

interface RecordedModelRequest {
	modelId: string;
	systemPrompt: string;
	toolNames: string[];
}

const modelRequests: RecordedModelRequest[] = [];

registerHandler(PROVIDER_ID, (config) => {
	const modelId = config.modelId;
	const handler: ApiHandler = {
		getMessages: () => [],
		getModel: () => ({ id: modelId, info: { id: modelId } }),
		async *createMessage(
			systemPrompt: string,
			_messages,
			tools?: ToolDefinition[],
		): AsyncGenerator<ApiStreamChunk> {
			modelRequests.push({
				modelId,
				systemPrompt,
				toolNames: (tools ?? []).map((tool) => tool.name).sort(),
			});
			const isFirstDelegatingRequest =
				systemPrompt.startsWith(DELEGATING_PROMPT) &&
				modelRequests.filter((request) =>
					request.systemPrompt.startsWith(DELEGATING_PROMPT),
				).length === 1;
			if (isFirstDelegatingRequest) {
				yield {
					type: "tool_calls",
					id: `${modelId}-response`,
					tool_call: {
						call_id: "spawn-call-1",
						function: {
							name: "spawn_agent",
							arguments: {
								systemPrompt: CHILD_PROMPT,
								task: "Review the workspace.",
							},
						},
					},
				};
				return;
			}
			yield { type: "text", id: `${modelId}-response`, text: "done" };
		},
	};
	return handler;
});

const envSnapshot = {
	HOME: process.env.HOME,
	CLINE_DIR: process.env.CLINE_DIR,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
};

let root = "";
let workspace = "";
let transport: HubServerTransport | undefined;

beforeEach(() => {
	modelRequests.length = 0;
	root = mkdtempSync(join(tmpdir(), "hub-session-agent-config-"));
	workspace = join(root, "workspace");
	mkdirSync(workspace);
	process.env.HOME = root;
	process.env.CLINE_DIR = join(root, ".cline");
	delete process.env.CLINE_DATA_DIR;
	setHomeDir(root);
	setClineDir(process.env.CLINE_DIR);
});

afterEach(async () => {
	await transport?.stop();
	transport = undefined;
	process.env.HOME = envSnapshot.HOME;
	process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
	if (envSnapshot.CLINE_DATA_DIR === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
	}
	setHomeDir(envSnapshot.HOME ?? "~");
	setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
	rmSync(root, { recursive: true, force: true });
});

async function command(
	hub: HubServerTransport,
	envelope: Omit<HubCommandEnvelope, "version">,
): Promise<HubReplyEnvelope> {
	const reply = await hub.handleCommand({ version: "v1", ...envelope });
	if (!reply.ok) {
		throw new Error(
			`${envelope.command} failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return reply;
}

async function startHub(): Promise<HubServerTransport> {
	const hub = new HubServerTransport({
		workspaceRoot: workspace,
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		scheduleOptions: { dbPath: ":memory:" },
		taskOptions: {
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
		},
		fetch: (async () =>
			new Response("offline", { status: 503 })) as unknown as typeof fetch,
	});
	transport = hub;
	await hub.start();
	for (const clientId of ["desktop", "vscode"]) {
		await command(hub, {
			command: "client.register",
			clientId,
			payload: { clientId, clientType: clientId, transport: "native" },
		});
	}
	return hub;
}

async function createSession(
	hub: HubServerTransport,
	input: {
		clientId: string;
		modelId: string;
		systemPrompt: string;
		toolPolicies: Record<string, { enabled?: boolean; autoApprove?: boolean }>;
		clientContributions?: unknown[];
		enableSpawnAgent?: boolean;
	},
): Promise<string> {
	const reply = await command(hub, {
		command: "session.create",
		clientId: input.clientId,
		payload: {
			workspaceRoot: workspace,
			cwd: workspace,
			sessionConfig: {
				providerId: PROVIDER_ID,
				modelId: input.modelId,
				cwd: workspace,
				workspaceRoot: workspace,
				systemPrompt: input.systemPrompt,
				mode: "act",
				enableTools: true,
				enableSpawnAgent: input.enableSpawnAgent === true,
				enableAgentTeams: false,
			},
			toolPolicies: input.toolPolicies,
			runtimeOptions: input.clientContributions
				? { clientContributions: input.clientContributions }
				: {},
		},
	});
	const sessionId = (reply.payload?.session as { sessionId?: string })
		?.sessionId;
	if (!sessionId) throw new Error("session.create returned no session id");
	return sessionId;
}

async function sendInput(
	hub: HubServerTransport,
	clientId: string,
	sessionId: string,
): Promise<void> {
	await command(hub, {
		command: "session.send_input",
		clientId,
		sessionId,
		payload: { prompt: "Summarize the workspace." },
	});
}

function requestsFor(modelId: string): RecordedModelRequest[] {
	return modelRequests.filter((request) => request.modelId === modelId);
}

describe("Hub session agent config", () => {
	it("keeps each session's system prompt and tool policy regardless of attached clients", async () => {
		const hub = await startHub();

		// The creator brokers two IDE tools, but this session denies one of them
		// and shell access.
		const fullSessionId = await createSession(hub, {
			clientId: "desktop",
			modelId: "full-model",
			systemPrompt: "You are the full-access parent session.",
			toolPolicies: {
				"*": { autoApprove: true },
				run_commands: { enabled: false },
				open_in_editor: { enabled: false },
			},
			clientContributions: ["open_in_editor", "ide_diagnostics"].map(
				(name) => ({
					kind: "tool",
					name,
					description: `IDE tool ${name}.`,
					inputSchema: { type: "object" },
					capabilityName: `custom_tool.${name}`,
				}),
			),
		});
		const readOnlySessionId = await createSession(hub, {
			clientId: "desktop",
			modelId: "read-only-model",
			systemPrompt: "You are a read-only reviewer.",
			toolPolicies: {
				"*": { enabled: false, autoApprove: true },
				read_files: { enabled: true },
			},
		});

		for (const sessionId of [fullSessionId, readOnlySessionId]) {
			await command(hub, {
				command: "session.attach",
				clientId: "vscode",
				sessionId,
			});
			await sendInput(hub, "desktop", sessionId);
			await sendInput(hub, "vscode", sessionId);
		}
		await command(hub, {
			command: "session.detach",
			clientId: "desktop",
			sessionId: fullSessionId,
		});
		await sendInput(hub, "vscode", fullSessionId);

		const fullRequests = requestsFor("full-model");
		expect(fullRequests).toHaveLength(3);
		for (const request of fullRequests) {
			expect(request.systemPrompt).toContain(
				"You are the full-access parent session.",
			);
			expect(request.systemPrompt).not.toContain("read-only reviewer");
			expect(request.toolNames).toEqual(
				expect.arrayContaining(["ide_diagnostics", "read_files"]),
			);
			expect(request.toolNames).not.toContain("run_commands");
			expect(request.toolNames).not.toContain("open_in_editor");
			expect(request.toolNames).toEqual(fullRequests[0]?.toolNames);
		}

		const readOnlyRequests = requestsFor("read-only-model");
		expect(readOnlyRequests).toHaveLength(2);
		for (const request of readOnlyRequests) {
			expect(request.systemPrompt).toContain("You are a read-only reviewer.");
			expect(request.systemPrompt).not.toContain("full-access parent");
			expect(request.toolNames).toEqual(["read_files"]);
		}
	});

	it("keeps a session's disabled tools out of agents it spawns", async () => {
		const hub = await startHub();
		const sessionId = await createSession(hub, {
			clientId: "desktop",
			modelId: "delegating-model",
			systemPrompt: DELEGATING_PROMPT,
			enableSpawnAgent: true,
			toolPolicies: {
				"*": { autoApprove: true },
				run_commands: { enabled: false },
			},
		});

		await sendInput(hub, "desktop", sessionId);

		const parentRequests = modelRequests.filter((request) =>
			request.systemPrompt.startsWith(DELEGATING_PROMPT),
		);
		const childRequests = modelRequests.filter((request) =>
			request.systemPrompt.includes(CHILD_PROMPT),
		);
		expect(parentRequests.length).toBeGreaterThan(0);
		expect(parentRequests[0]?.toolNames).toContain("spawn_agent");
		expect(parentRequests[0]?.toolNames).not.toContain("run_commands");
		expect(childRequests).toHaveLength(1);
		expect(childRequests[0]?.toolNames).toContain("read_files");
		expect(childRequests[0]?.toolNames).not.toContain("run_commands");
	});
});
