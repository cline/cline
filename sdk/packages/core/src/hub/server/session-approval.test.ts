import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, HubCommandEnvelope } from "@cline/shared";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { SessionRuntime } from "../../runtime/orchestration/session-runtime-orchestrator";
import { FileSessionService } from "../../session/services/file-session-service";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";

const originalClineDir = resolveClineDir();
let root: string;
let transport: HubServerTransport;
let runtime: LocalRuntimeHost;
let service: FileSessionService;
let effectivePolicies: AgentConfig["toolPolicies"];

function startHub(defaults?: AgentConfig["toolPolicies"]) {
	service = new FileSessionService(join(root, "sessions"));
	runtime = new LocalRuntimeHost({
		sessionService: service,
		toolPolicies: defaults,
		createAgent: (config) => {
			effectivePolicies = config.toolPolicies;
			return new SessionRuntime(config);
		},
	});
	transport = new HubServerTransport({
		sessionHost: runtime,
		workspaceRoot: root,
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
}

async function stopHub() {
	await runtime.stopSession("approval-test");
	await transport.stop();
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "hub-approval-"));
	setClineDir(join(root, ".cline"));
	startHub();
});
afterEach(async () => {
	await stopHub();
	setClineDir(originalClineDir);
	await rm(root, { recursive: true, force: true });
});

async function command(
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown> = {},
) {
	const reply = await transport.handleCommand({
		version: "v1",
		requestId: "approval-request",
		clientId: "test",
		sessionId: "approval-test",
		command,
		payload: {
			workspaceRoot: root,
			cwd: root,
			sessionConfig: {
				sessionId: "approval-test",
				providerId: "openai-compatible",
				modelId: "test-model",
				apiKey: "synthetic-key",
				mode: "act",
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			runtimeOptions: { configExtensions: [] },
			...(command === "session.create"
				? { initialMessages: [{ role: "user", content: "Saved conversation" }] }
				: {}),
			...payload,
		},
	});
	expect(reply.ok, JSON.stringify(reply.error)).toBe(true);
}

function expectApproval(expected: boolean) {
	expect(effectivePolicies?.["*"]?.autoApprove !== false).toBe(expected);
	expectSavedApproval(expected);
}

function expectSavedApproval(expected: boolean) {
	expect(
		service.readSessionManifest("approval-test")?.metadata?.autoApproveTools,
	).toBe(expected);
}

it.each([
	{ name: "omitted policy", payload: {}, expected: true },
	{
		name: "explicit policy",
		payload: { toolPolicies: { "*": { autoApprove: false } } },
		expected: false,
	},
])("persists the runtime approval choice for $name", async ({
	payload,
	expected,
}) => {
	await command("session.create", payload);
	expectApproval(expected);
});

it("preserves host defaults and disabled tools", async () => {
	await stopHub();
	startHub({ "*": { autoApprove: false }, disabled_tool: { enabled: false } });
	await command("session.create");
	expectApproval(false);
	expect(effectivePolicies?.disabled_tool).toEqual({ enabled: false });
	await stopHub();
	startHub();
	await command("session.resume", {
		toolPolicies: { disabled_tool: { enabled: false } },
	});
	expectSavedApproval(false);
	expect(effectivePolicies?.disabled_tool).toEqual({ enabled: false });
});

it.each([
	true,
	false,
])("resumes saved approval %s and persists an explicit override", async (saved) => {
	await command("session.create", {
		toolPolicies: { "*": { autoApprove: saved } },
	});
	expectApproval(saved);
	await stopHub();
	startHub();
	await command("session.resume", { metadata: { autoApproveTools: !saved } });
	expectSavedApproval(saved);
	expect(effectivePolicies?.["*"]?.autoApprove !== false).toBe(true);
	await command("session.update", { title: "Renamed after resume" });
	expectSavedApproval(saved);
	expect(service.readSessionManifest("approval-test")?.metadata?.title).toBe(
		"Renamed after resume",
	);
	await stopHub();
	startHub();
	await command("session.resume", {
		toolPolicies: { "*": { autoApprove: !saved } },
	});
	expectApproval(!saved);
	await stopHub();
	startHub();
	await command("session.resume");
	expectSavedApproval(!saved);
});
