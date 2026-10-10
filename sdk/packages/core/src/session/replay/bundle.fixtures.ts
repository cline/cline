import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import type { SessionRecord } from "../../types/sessions";
import type { SessionReplayExportSource } from "./bundle-export";
import { resolveSessionHookLogPath } from "./bundle-hook-events";

export const FIXTURE_SESSION_ID = "sess_fixture";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

export function fixtureMessages(): MessageWithMetadata[] {
	return [
		{
			id: "m1",
			role: "user",
			content: [
				{ type: "text", text: "<user_input>List the files</user_input>" },
			],
			ts: T0,
		},
		{
			id: "m2",
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "I should run ls." },
				{ type: "text", text: "Running ls." },
				{
					type: "tool_use",
					id: "call_1",
					name: "run_commands",
					input: { commands: ["ls"] },
				},
			],
			ts: T0 + 1_000,
			modelInfo: { id: "fake-model", provider: "openai-compatible" },
			metrics: { inputTokens: 100, outputTokens: 20, cost: 0.001 },
			metadata: { requestId: "req_secret_1", note: "/home/alice/project" },
		},
		{
			id: "m3",
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_1",
					name: "run_commands",
					content: "a.txt\nb.txt",
				},
			],
			ts: T0 + 1_500,
		},
		{
			id: "m4",
			role: "assistant",
			content: [{ type: "text", text: "There are two files." }],
			ts: T0 + 3_000,
			modelInfo: { id: "fake-model", provider: "openai-compatible" },
			metrics: { inputTokens: 130, outputTokens: 8, cost: 0.0005 },
		},
	];
}

export function fixtureRecord(
	overrides: Partial<SessionRecord> = {},
): SessionRecord {
	return {
		sessionId: FIXTURE_SESSION_ID,
		source: "cli",
		status: "completed",
		exitCode: 0,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:00:04.000Z",
		interactive: false,
		provider: "openai-compatible",
		model: "fake-model",
		cwd: "/home/alice/project",
		workspaceRoot: "/home/alice/project",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-01-01T00:00:04.000Z",
		metadata: {
			title: "List files in /Users/alice/project",
			apiKey: "sk-live-123",
			totalCost: 0.0015,
			userId: "usr_123",
			checkpoint: {
				latest: { ref: "abc123", createdAt: T0 + 3_000, runCount: 1 },
				history: [{ ref: "abc123", createdAt: T0 + 3_000, runCount: 1 }],
			},
		},
		...overrides,
	};
}

export function fixtureHookEntries(
	sessionId = FIXTURE_SESSION_ID,
): Record<string, unknown>[] {
	const context = { rootSessionId: sessionId, hookName: "tool_call" };
	return [
		{
			ts: "2026-01-01T00:00:01.100Z",
			hookName: "tool_call",
			taskId: "conv_1",
			agent_id: "agent_root",
			iteration: 1,
			userId: "usr_123",
			sessionContext: context,
			tool_call: {
				id: "call_1",
				name: "run_commands",
				input: { commands: ["ls"] },
			},
		},
		{
			ts: "2026-01-01T00:00:01.400Z",
			hookName: "tool_result",
			taskId: "conv_1",
			agent_id: "agent_root",
			iteration: 1,
			sessionContext: context,
			tool_result: {
				id: "call_1",
				name: "run_commands",
				durationMs: 250,
				startedAt: "2026-01-01T00:00:01.150Z",
				endedAt: "2026-01-01T00:00:01.400Z",
			},
		},
		{
			ts: "2026-01-01T00:00:02.000Z",
			hookName: "tool_call",
			agent_id: "agent_child",
			parent_agent_id: "agent_root",
			sessionContext: context,
			tool_call: { id: "call_child", name: "read_files", input: {} },
		},
		{
			ts: "2026-01-01T00:00:03.100Z",
			hookName: "agent_end",
			taskId: "conv_1",
			agent_id: "agent_root",
			sessionContext: context,
		},
		{
			ts: "2026-01-01T00:00:03.200Z",
			hookName: "agent_end",
			agent_id: "agent_other",
			sessionContext: { rootSessionId: "sess_other" },
		},
	];
}

export async function writeHookLog(
	path: string,
	entries: readonly Record<string, unknown>[],
): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(
		path,
		`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\nnot json\n`,
		"utf8",
	);
}

export async function writeSessionArtifacts(input: {
	sessionsDir: string;
	sessionId?: string;
	systemPrompt?: string;
	messages?: MessageWithMetadata[];
	hookEntries?: Record<string, unknown>[];
}): Promise<{ messagesPath: string; hookLogPath: string }> {
	const sessionId = input.sessionId ?? FIXTURE_SESSION_ID;
	const dir = join(input.sessionsDir, sessionId);
	await mkdir(dir, { recursive: true });
	const messagesPath = join(dir, `${sessionId}.messages.json`);
	await writeFile(
		messagesPath,
		JSON.stringify({
			version: 1,
			updated_at: "2026-01-01T00:00:04.000Z",
			system_prompt: input.systemPrompt ?? "You are a test agent.",
			messages: input.messages ?? fixtureMessages(),
		}),
		"utf8",
	);
	const hookLogPath = resolveSessionHookLogPath(input.sessionsDir, sessionId);
	if (input.hookEntries) {
		await writeHookLog(hookLogPath, input.hookEntries);
	}
	return { messagesPath, hookLogPath };
}

export function fixtureSource(input: {
	record?: SessionRecord;
	messages?: MessageWithMetadata[];
}): SessionReplayExportSource {
	const record = input.record ?? fixtureRecord();
	return {
		getSession: async (sessionId) =>
			sessionId === record.sessionId ? record : undefined,
		readMessages: async () => input.messages ?? fixtureMessages(),
	};
}
