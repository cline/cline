import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it } from "vitest";
import { CoreSessionService } from "../../session/services/session-service";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import { ClaudeCodeImportAdapter } from "./claude-code";
import { CodexImportAdapter } from "./codex";
import { OpencodeImportAdapter } from "./opencode";
import {
	IMPORT_MISSING_TOOL_RESULT_TEXT,
	sanitizeImportedMessages,
} from "./sanitize";
import { SessionImportService } from "./service";

const tempDirs: string[] = [];
const openStores: SqliteSessionStore[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * An initialized store whose SQLite handle is closed during teardown. Windows
 * refuses to remove a directory that still holds an open file, so leaving the
 * db open fails the temp-dir cleanup with EPERM.
 */
function sessionStore(sessionsDir: string): SqliteSessionStore {
	const store = new SqliteSessionStore({ sessionsDir });
	store.init();
	openStores.push(store);
	return store;
}

afterEach(() => {
	while (openStores.length > 0) openStores.pop()?.close();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function jsonl(lines: unknown[]): string {
	return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

/** Message content as loosely-typed blocks for assertions on raw fields. */
function blocks(message: { content: unknown }): Array<Record<string, unknown>> {
	return message.content as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Claude Code fixtures
// ---------------------------------------------------------------------------

function writeClaudeCodeFixture(projectsDir: string): string {
	const dir = join(projectsDir, "-workspace-demo");
	mkdirSync(dir, { recursive: true });
	const base = {
		cwd: "/workspace/demo",
		gitBranch: "main",
		isSidechain: false,
		sessionId: "abc",
		version: "2.0.0",
	};
	const lines = [
		{ type: "mode", mode: "normal", sessionId: "abc" },
		{
			...base,
			type: "user",
			uuid: "u1",
			parentUuid: null,
			timestamp: "2026-01-02T10:00:00.000Z",
			message: { role: "user", content: "fix the bug in parser.ts" },
		},
		{
			...base,
			type: "assistant",
			uuid: "a1",
			parentUuid: "u1",
			timestamp: "2026-01-02T10:00:05.000Z",
			message: {
				id: "msg_1",
				role: "assistant",
				model: "claude-fable-5",
				content: [
					{ type: "thinking", thinking: "let me look", signature: "sig-abc" },
					{ type: "text", text: "Looking at the parser now." },
				],
				usage: { input_tokens: 100, output_tokens: 20 },
			},
		},
		// Same API turn continues on a second line sharing message.id.
		{
			...base,
			type: "assistant",
			uuid: "a2",
			parentUuid: "a1",
			timestamp: "2026-01-02T10:00:06.000Z",
			message: {
				id: "msg_1",
				role: "assistant",
				model: "claude-fable-5",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "Read",
						input: { file_path: "/workspace/demo/parser.ts" },
						caller: { type: "direct" },
					},
				],
				usage: { input_tokens: 100, output_tokens: 30 },
			},
		},
		{
			...base,
			type: "user",
			uuid: "u2",
			parentUuid: "a2",
			timestamp: "2026-01-02T10:00:07.000Z",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "export function parse() {}",
					},
				],
			},
		},
		// Sidechain (subagent) traffic must be ignored.
		{
			...base,
			isSidechain: true,
			type: "user",
			uuid: "s1",
			parentUuid: null,
			message: { role: "user", content: "sidechain prompt" },
		},
		// Abandoned branch: an earlier retry off a1 that nothing continues.
		{
			...base,
			type: "assistant",
			uuid: "dead1",
			parentUuid: "u1",
			timestamp: "2026-01-02T10:00:04.000Z",
			message: {
				id: "msg_dead",
				role: "assistant",
				model: "claude-fable-5",
				content: [{ type: "text", text: "abandoned branch answer" }],
			},
		},
		// Meta/command lines must not become conversation.
		{
			...base,
			type: "user",
			uuid: "m1",
			parentUuid: "u2",
			isMeta: true,
			message: { role: "user", content: "<local-command-caveat>noise" },
		},
		{
			...base,
			type: "assistant",
			uuid: "a3",
			parentUuid: "m1",
			timestamp: "2026-01-02T10:00:10.000Z",
			message: {
				id: "msg_2",
				role: "assistant",
				model: "claude-fable-5",
				content: [{ type: "text", text: "Fixed. The parser now handles it." }],
				usage: {
					input_tokens: 200,
					output_tokens: 40,
					cache_read_input_tokens: 50,
				},
			},
		},
		{ type: "ai-title", aiTitle: "Fix parser bug", sessionId: "abc" },
	];
	writeFileSync(join(dir, "abc.jsonl"), jsonl(lines));
	return dir;
}

describe("ClaudeCodeImportAdapter", () => {
	it("discovers, walks the active branch, merges turns, and strips noise", () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const adapter = new ClaudeCodeImportAdapter({ projectsDir });

		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].title).toBe("Fix parser bug");
		expect(discovered[0].cwd).toBe("/workspace/demo");
		expect(discovered[0].preview).toBe("fix the bug in parser.ts");

		const converted = adapter.convert("abc");
		expect(converted.provider).toBe("anthropic");
		expect(converted.model).toBe("claude-fable-5");
		expect(converted.gitBranch).toBe("main");

		const roles = converted.messages.map((message) => message.role);
		expect(roles).toEqual(["user", "assistant", "user", "assistant"]);

		// Turn merge: thinking + text + tool_use in one assistant message.
		const firstAssistant = converted.messages[1];
		expect(Array.isArray(firstAssistant.content)).toBe(true);
		const types = (firstAssistant.content as Array<{ type: string }>).map(
			(block) => block.type,
		);
		expect(types).toEqual(["thinking", "text", "tool_use"]);
		expect(firstAssistant.modelInfo).toEqual({
			id: "claude-fable-5",
			provider: "anthropic",
		});
		expect(firstAssistant.metrics?.inputTokens).toBe(100);

		// The abandoned branch and sidechain never appear.
		const allText = JSON.stringify(converted.messages);
		expect(allText).not.toContain("abandoned branch answer");
		expect(allText).not.toContain("sidechain prompt");
		expect(allText).not.toContain("local-command-caveat");
		// Thinking signatures are session-scoped; adapters drop them.
		expect(allText).not.toContain("sig-abc");
	});

	it("skips slash-command-only sessions in discovery", () => {
		const projectsDir = tempDir("cc-import-");
		const dir = join(projectsDir, "-workspace-empty");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "empty.jsonl"),
			jsonl([
				{
					type: "user",
					uuid: "u1",
					parentUuid: null,
					isSidechain: false,
					message: {
						role: "user",
						content: "<command-name>/fast</command-name>",
					},
				},
			]),
		);
		const adapter = new ClaudeCodeImportAdapter({ projectsDir });
		expect(adapter.discover()).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Codex fixtures
// ---------------------------------------------------------------------------

function writeCodexFixture(codexHome: string): void {
	const dayDir = join(codexHome, "sessions", "2026", "01", "05");
	mkdirSync(dayDir, { recursive: true });
	const lines = [
		{
			timestamp: "2026-01-05T09:00:00.000Z",
			type: "session_meta",
			payload: {
				id: "cdx-1",
				cwd: "/workspace/api",
				model_provider: "openai",
				git: { branch: "feat/x" },
			},
		},
		{
			timestamp: "2026-01-05T09:00:00.100Z",
			type: "turn_context",
			payload: { model: "gpt-5.5", cwd: "/workspace/api" },
		},
		// Injected context arrives as a user response_item — never imported.
		{
			timestamp: "2026-01-05T09:00:00.200Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: "<user_instructions>be nice</user_instructions>",
					},
				],
			},
		},
		{
			timestamp: "2026-01-05T09:00:01.000Z",
			type: "event_msg",
			payload: { type: "user_message", message: "add a healthcheck endpoint" },
		},
		{
			timestamp: "2026-01-05T09:00:02.000Z",
			type: "response_item",
			payload: {
				type: "reasoning",
				summary: [{ type: "summary_text", text: "Need to add a route." }],
				encrypted_content: "opaque",
			},
		},
		{
			timestamp: "2026-01-05T09:00:03.000Z",
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				call_id: "call_1",
				arguments: JSON.stringify({ cmd: "ls src/routes" }),
			},
		},
		{
			timestamp: "2026-01-05T09:00:04.000Z",
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "call_1",
				output: "health.ts\nusers.ts",
			},
		},
		{
			timestamp: "2026-01-05T09:00:05.000Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Added the /health route." }],
			},
		},
		{
			timestamp: "2026-01-05T09:00:05.500Z",
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					last_token_usage: {
						input_tokens: 900,
						cached_input_tokens: 400,
						output_tokens: 80,
					},
				},
			},
		},
	];
	writeFileSync(
		join(dayDir, "rollout-2026-01-05T09-00-00-cdx-1.jsonl"),
		jsonl(lines),
	);
	writeFileSync(
		join(codexHome, "session_index.jsonl"),
		jsonl([
			{
				id: "cdx-1",
				thread_name: "healthcheck endpoint",
				updated_at: "2026-01-05T09:10:00Z",
			},
		]),
	);
}

describe("CodexImportAdapter", () => {
	it("imports prompts from user_message events and pairs tool calls", () => {
		const codexHome = tempDir("codex-import-");
		writeCodexFixture(codexHome);
		const adapter = new CodexImportAdapter({ codexHome });

		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].title).toBe("healthcheck endpoint");
		expect(discovered[0].cwd).toBe("/workspace/api");

		const converted = adapter.convert("cdx-1");
		expect(converted.provider).toBe("openai-native");
		expect(converted.model).toBe("gpt-5.5");
		expect(converted.gitBranch).toBe("feat/x");

		const roles = converted.messages.map((message) => message.role);
		expect(roles).toEqual(["user", "assistant", "user", "assistant"]);

		const allText = JSON.stringify(converted.messages);
		expect(allText).not.toContain("user_instructions");
		expect(allText).not.toContain("opaque");

		const firstAssistant = converted.messages[1];
		const types = (firstAssistant.content as Array<{ type: string }>).map(
			(block) => block.type,
		);
		expect(types).toEqual(["thinking", "tool_use"]);

		const toolResult = blocks(converted.messages[2])[0];
		expect(toolResult.type).toBe("tool_result");
		expect(toolResult.tool_use_id).toBe("call_1");
		expect(toolResult.name).toBe("exec_command");

		// token_count usage lands on the final assistant message.
		const lastAssistant = converted.messages[3];
		expect(lastAssistant.metrics).toEqual({
			inputTokens: 900,
			outputTokens: 80,
			cacheReadTokens: 400,
			cacheWriteTokens: 0,
			cost: 0,
		});
	});

	it("flattens content-block tool outputs from newer rollouts into text", () => {
		const codexHome = tempDir("codex-import-blocks-");
		const dayDir = join(codexHome, "sessions", "2026", "02", "01");
		mkdirSync(dayDir, { recursive: true });
		writeFileSync(
			join(dayDir, "rollout-2026-02-01T09-00-00-cdx-2.jsonl"),
			jsonl([
				{
					timestamp: "2026-02-01T09:00:00.000Z",
					type: "session_meta",
					payload: { id: "cdx-2", cwd: "/workspace/api" },
				},
				{
					timestamp: "2026-02-01T09:00:01.000Z",
					type: "event_msg",
					payload: { type: "user_message", message: "list the routes" },
				},
				{
					timestamp: "2026-02-01T09:00:02.000Z",
					type: "response_item",
					payload: {
						type: "custom_tool_call",
						name: "exec",
						call_id: "call_blocks",
						input: 'const r = await tools.exec_command({"cmd":"ls"});',
					},
				},
				{
					timestamp: "2026-02-01T09:00:03.000Z",
					type: "response_item",
					payload: {
						type: "custom_tool_call_output",
						call_id: "call_blocks",
						output: [
							{ type: "input_text", text: "Script completed\nOutput:\n" },
							{ type: "input_text", text: "health.ts\nusers.ts\n" },
						],
					},
				},
				{
					timestamp: "2026-02-01T09:00:04.000Z",
					type: "response_item",
					payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Two routes." }],
					},
				},
			]),
		);
		const adapter = new CodexImportAdapter({ codexHome });
		const converted = adapter.convert("cdx-2");
		const toolResult = (
			converted.messages[2].content as unknown as Array<Record<string, unknown>>
		)[0];
		expect(toolResult.type).toBe("tool_result");
		expect(toolResult.content).toBe(
			"Script completed\nOutput:\nhealth.ts\nusers.ts\n",
		);
		expect(JSON.stringify(converted.messages)).not.toContain("input_text");
	});

	it("dedupes resumed rollouts sharing one session id, keeping the richer file", () => {
		const codexHome = tempDir("codex-import-");
		writeCodexFixture(codexHome);
		// A resumed rollout for the same session with more conversation.
		const dayDir = join(codexHome, "sessions", "2026", "01", "06");
		mkdirSync(dayDir, { recursive: true });
		writeFileSync(
			join(dayDir, "rollout-2026-01-06T09-00-00-resume.jsonl"),
			jsonl([
				{
					timestamp: "2026-01-06T09:00:00.000Z",
					type: "session_meta",
					payload: { id: "cdx-1", cwd: "/workspace/api" },
				},
				{
					timestamp: "2026-01-06T09:00:01.000Z",
					type: "event_msg",
					payload: {
						type: "user_message",
						message: "add a healthcheck endpoint",
					},
				},
				{
					timestamp: "2026-01-06T09:00:02.000Z",
					type: "event_msg",
					payload: { type: "user_message", message: "now add tests for it" },
				},
				{
					timestamp: "2026-01-06T09:00:03.000Z",
					type: "response_item",
					payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Tests added." }],
					},
				},
			]),
		);
		const adapter = new CodexImportAdapter({ codexHome });
		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].sourcePath).toContain("resume");

		const converted = adapter.convert("cdx-1");
		const text = JSON.stringify(converted.messages);
		expect(text).toContain("now add tests for it");
	});
});

// ---------------------------------------------------------------------------
// opencode fixtures
// ---------------------------------------------------------------------------

function writeOpencodeFixture(dataDir: string): void {
	mkdirSync(dataDir, { recursive: true });
	const db = loadSqliteDb(join(dataDir, "opencode.db"));
	db.exec(`
		CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT,
			slug TEXT, directory TEXT, title TEXT, version TEXT,
			time_created INTEGER, time_updated INTEGER);
		CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT,
			time_created INTEGER, time_updated INTEGER, data TEXT);
		CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
			time_created INTEGER, time_updated INTEGER, data TEXT);
	`);
	const t0 = 1767600000000;
	db.prepare(
		`INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
		 VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
	).run(
		"ses_1",
		"prj",
		"slug",
		"/workspace/web",
		"Refactor navbar",
		"1.0",
		t0,
		t0 + 60000,
	);
	// Child (subagent) session must be ignored.
	db.prepare(
		`INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		"ses_child",
		"prj",
		"ses_1",
		"s",
		"/workspace/web",
		"child",
		"1.0",
		t0,
		t0,
	);

	const insertMessage = db.prepare(
		`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
	);
	const insertPart = db.prepare(
		`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`,
	);
	insertMessage.run(
		"msg_1",
		"ses_1",
		t0,
		t0,
		JSON.stringify({ role: "user", time: { created: t0 } }),
	);
	insertPart.run(
		"prt_1",
		"msg_1",
		"ses_1",
		t0,
		t0,
		JSON.stringify({ type: "text", text: "make the navbar sticky" }),
	);
	insertPart.run(
		"prt_2",
		"msg_1",
		"ses_1",
		t0,
		t0,
		JSON.stringify({ type: "text", text: "AGENTS ctx", synthetic: true }),
	);
	insertMessage.run(
		"msg_2",
		"ses_1",
		t0 + 1000,
		t0 + 1000,
		JSON.stringify({
			role: "assistant",
			providerID: "anthropic",
			modelID: "claude-sonnet-5",
			cost: 0.12,
			tokens: { input: 500, output: 60, cache: { read: 100, write: 5 } },
			time: { created: t0 + 1000 },
		}),
	);
	insertPart.run(
		"prt_3",
		"msg_2",
		"ses_1",
		t0,
		t0,
		JSON.stringify({ type: "reasoning", text: "css change" }),
	);
	insertPart.run(
		"prt_4",
		"msg_2",
		"ses_1",
		t0,
		t0,
		JSON.stringify({
			type: "tool",
			tool: "edit",
			callID: "call_a",
			state: {
				status: "completed",
				input: { filePath: "nav.css" },
				output: "edited",
			},
		}),
	);
	insertPart.run(
		"prt_5",
		"msg_2",
		"ses_1",
		t0,
		t0,
		JSON.stringify({ type: "text", text: "Done — navbar is sticky." }),
	);
	db.close?.();
}

describe("OpencodeImportAdapter", () => {
	it("splits inline tool parts into tool_use/tool_result and skips children", () => {
		const dataDir = tempDir("oc-import-");
		writeOpencodeFixture(dataDir);
		const adapter = new OpencodeImportAdapter({ dataDir });

		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].sourceId).toBe("ses_1");
		expect(discovered[0].title).toBe("Refactor navbar");

		const converted = adapter.convert("ses_1");
		expect(converted.provider).toBe("anthropic");
		expect(converted.model).toBe("claude-sonnet-5");

		const roles = converted.messages.map((message) => message.role);
		expect(roles).toEqual(["user", "assistant", "user", "assistant"]);

		const allText = JSON.stringify(converted.messages);
		expect(allText).not.toContain("AGENTS ctx");

		const firstAssistant = converted.messages[1].content as Array<{
			type: string;
		}>;
		expect(firstAssistant.map((block) => block.type)).toEqual([
			"thinking",
			"tool_use",
		]);
		const toolResult = blocks(converted.messages[2])[0];
		expect(toolResult.tool_use_id).toBe("call_a");
		expect(toolResult.content).toBe("edited");

		const lastAssistant = converted.messages[3];
		expect(lastAssistant.metrics).toEqual({
			inputTokens: 500,
			outputTokens: 60,
			cacheReadTokens: 100,
			cacheWriteTokens: 5,
			cost: 0.12,
		});
	});
});

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

describe("sanitizeImportedMessages", () => {
	it("repairs orphaned tool_use, drops orphaned tool_result and empty text", () => {
		const sanitized = sanitizeImportedMessages([
			{ role: "user", content: [{ type: "text", text: "   " }] },
			{ role: "user", content: "do the thing" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "on it", signature: "gemini-sig" },
					{ type: "tool_use", id: "t1", name: "bash", input: {} },
				],
			},
			// No tool_result for t1; and an orphan result for a nonexistent id.
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "ghost", name: "", content: "x" },
				],
			},
		]);

		expect(sanitized.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
		]);
		const repair = blocks(sanitized[2]);
		expect(repair[0].type).toBe("tool_result");
		expect(repair[0].tool_use_id).toBe("t1");
		expect(repair[0].content).toBe(IMPORT_MISSING_TOOL_RESULT_TEXT);
		expect(JSON.stringify(sanitized)).not.toContain("ghost");
		expect(JSON.stringify(sanitized)).not.toContain("gemini-sig");
	});

	it("consolidates a turn's tool_results into the message right after the tool_use", () => {
		const sanitized = sanitizeImportedMessages([
			{ role: "user", content: "run both" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "a", name: "bash", input: {} },
					{ type: "tool_use", id: "b", name: "bash", input: {} },
					{ type: "tool_use", id: "c", name: "bash", input: {} },
				],
			},
			// Results split across messages, out of order, one missing (c),
			// plus a real follow-up prompt mixed into the span.
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "b", name: "bash", content: "B" },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "a", name: "bash", content: "A" },
					{ type: "text", text: "also do this next" },
				],
			},
			{ role: "assistant", content: "ok" },
		]);

		expect(sanitized.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"user",
			"assistant",
		]);
		const consolidated = blocks(sanitized[2]);
		expect(consolidated.map((block) => block.tool_use_id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(consolidated[2].content).toBe(IMPORT_MISSING_TOOL_RESULT_TEXT);
		const leftovers = blocks(sanitized[3]);
		expect(leftovers).toEqual([{ type: "text", text: "also do this next" }]);
	});
});

// ---------------------------------------------------------------------------
// End-to-end: service writes listable, gate-passing sessions
// ---------------------------------------------------------------------------

describe("SessionImportService", () => {
	it("imports a discovered session into a listable completed Cline session", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const dbDir = tempDir("cline-db-");
		const artifactsDir = tempDir("cline-sessions-");

		const store = sessionStore(dbDir);
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const discovered = await importer.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].alreadyImportedSessionId).toBeUndefined();

		const [result] = await importer.importMany([
			{ tool: "claude-code", sourceId: discovered[0].sourceId },
		]);
		expect(result.ok).toBe(true);
		const sessionId = result.sessionId as string;
		// Chronology: id epoch prefix comes from the source session start.
		expect(sessionId.startsWith(String(discovered[0].startedAtMs))).toBe(true);

		// Row passes every history-visibility gate.
		const row = store.get(sessionId);
		expect(row?.status).toBe("completed");
		expect(row?.exitCode).toBe(0);
		expect(row?.provider).toBe("anthropic");
		expect(row?.model).toBe("claude-fable-5");
		expect(row?.isSubagent).toBe(false);
		expect(row?.cwd).toBe("/workspace/demo");
		expect((row?.metadata as Record<string, unknown>)?.title).toBe(
			"Fix parser bug",
		);
		const importedFrom = (
			row?.metadata as Record<string, Record<string, unknown>>
		)?.importedFrom;
		expect(importedFrom?.tool).toBe("claude-code");
		expect(importedFrom?.sourceSessionId).toBe("abc");
		// History origin marks the import and the agent it came from, while
		// the top-level source stays the client surface.
		expect(row?.source).toBe("desktop");
		expect(
			(row?.metadata as Record<string, unknown>)?.sessionHistoryOrigin,
		).toEqual({ mode: "import", trigger: "claude-code" });
		// No fabricated checkpoint refs.
		expect(
			(row?.metadata as Record<string, unknown>)?.checkpoint,
		).toBeUndefined();

		// Messages artifact is a valid v1 payload with ≥1 message, and its
		// origin block carries the import provenance.
		const payload = JSON.parse(readFileSync(row?.messagesPath ?? "", "utf8"));
		expect(payload.version).toBe(1);
		expect(payload.origin).toMatchObject({
			source: "desktop",
			mode: "import",
			trigger: "claude-code",
		});
		expect(payload.messages.length).toBeGreaterThan(0);
		for (const message of payload.messages) {
			expect(typeof message.id).toBe("string");
		}

		// Manifest carries terminal status and source-era timestamps.
		const manifest = sessions.readSessionManifest(sessionId);
		expect(manifest?.status).toBe("completed");
		expect(manifest?.ended_at).toBe("2026-01-02T10:00:10.000Z");
		expect(manifest?.metadata?.title).toBe("Fix parser bug");
		expect(manifest?.metadata?.sessionHistoryOrigin).toEqual({
			mode: "import",
			trigger: "claude-code",
		});

		// Re-discovery flags the import instead of duplicating it.
		const rediscovered = await importer.discover();
		expect(rediscovered[0].alreadyImportedSessionId).toBe(sessionId);
	});

	it("stamps the resume provider/model on the row and keeps the source in metadata", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const dbDir = tempDir("cline-db-");
		const artifactsDir = tempDir("cline-sessions-");
		const store = sessionStore(dbDir);
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const [result] = await importer.importMany(
			[{ tool: "claude-code", sourceId: "abc" }],
			undefined,
			{ provider: "cline", model: "anthropic/claude-sonnet-5" },
		);
		expect(result.ok).toBe(true);
		const row = store.get(result.sessionId as string);
		// Opening the session resumes on the row's provider/model.
		expect(row?.provider).toBe("cline");
		expect(row?.model).toBe("anthropic/claude-sonnet-5");
		const importedFrom = (
			row?.metadata as Record<string, Record<string, unknown>>
		)?.importedFrom;
		expect(importedFrom?.sourceProvider).toBe("anthropic");
		expect(importedFrom?.sourceModel).toBe("claude-fable-5");
		// Per-message model info still reflects what actually produced it.
		const payload = JSON.parse(readFileSync(row?.messagesPath ?? "", "utf8"));
		const assistant = payload.messages.find(
			(message: { role: string }) => message.role === "assistant",
		);
		expect(assistant.modelInfo).toEqual({
			id: "claude-fable-5",
			provider: "anthropic",
		});

		// A half-specified target is ignored rather than mixing provider and
		// model from different worlds. (Fresh store: the same source is never
		// imported twice into one store.)
		const partialStore = sessionStore(tempDir("cline-db-"));
		const partialImporter = new SessionImportService(
			new CoreSessionService(partialStore, {
				sessionArtifactsDir: tempDir("cline-sessions-"),
			}),
			[new ClaudeCodeImportAdapter({ projectsDir })],
		);
		const [partial] = await partialImporter.importMany(
			[{ tool: "claude-code", sourceId: "abc" }],
			undefined,
			{ provider: "cline" },
		);
		expect(partialStore.get(partial.sessionId as string)?.provider).toBe(
			"anthropic",
		);
	});

	it("rolls back a half-written session when a later write fails", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const dbDir = tempDir("cline-db-");
		const artifactsDir = tempDir("cline-sessions-");
		const store = sessionStore(dbDir);
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const original = sessions.persistSessionMessages.bind(sessions);
		let failNext = true;
		sessions.persistSessionMessages = async (...args) => {
			if (failNext) {
				failNext = false;
				throw new Error("disk full");
			}
			return original(...args);
		};
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const [failed] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(failed.ok).toBe(false);
		expect(failed.error).toContain("disk full");
		// Nothing persisted: no row, no importedFrom marker blocking a retry.
		expect(store.list(50)).toHaveLength(0);
		const rediscovered = await importer.discover();
		expect(rediscovered[0].alreadyImportedSessionId).toBeUndefined();

		// The retry succeeds normally.
		const [retried] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(retried.ok).toBe(true);
		expect(store.list(50)).toHaveLength(1);
	});

	it("rolls back a session whose creation fails after the row is written", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const store = sessionStore(tempDir("cline-db-"));
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: tempDir("cline-sessions-"),
		});
		// createRootSessionWithArtifacts upserts the row, then writes the
		// messages file and manifest; simulate the file write failing.
		const original = sessions.createRootSessionWithArtifacts.bind(sessions);
		let failNext = true;
		sessions.createRootSessionWithArtifacts = async (input) => {
			const created = await original(input);
			if (failNext) {
				failNext = false;
				throw new Error("manifest write failed");
			}
			return created;
		};
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const [failed] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(failed.ok).toBe(false);
		expect(failed.error).toContain("manifest write failed");
		expect(store.list(50)).toHaveLength(0);

		const [retried] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(retried.ok).toBe(true);
		expect(store.list(50)).toHaveLength(1);
	});

	it("coalesces overlapping imports of the same source into one session", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const store = sessionStore(tempDir("cline-db-"));
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: tempDir("cline-sessions-"),
		});
		// Two separate services, as two import_sessions requests would build,
		// each snapshotting an empty set of existing imports.
		const makeImporter = () =>
			new SessionImportService(sessions, [
				new ClaudeCodeImportAdapter({ projectsDir }),
			]);
		const request = [{ tool: "claude-code" as const, sourceId: "abc" }];
		const [[first], [second]] = await Promise.all([
			makeImporter().importMany(request),
			makeImporter().importMany(request),
		]);
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		expect(first.sessionId).toBe(second.sessionId);
		expect([first.alreadyImported, second.alreadyImported]).toContain(true);
		expect(store.list(50)).toHaveLength(1);
	});

	it("never marks a session as imported unless every write succeeded", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const store = sessionStore(tempDir("cline-db-"));
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: tempDir("cline-sessions-"),
		});
		// Worst case: the messages write fails AND the rollback delete fails,
		// so a row survives. It must not carry the importedFrom marker.
		sessions.persistSessionMessages = async () => {
			throw new Error("disk full");
		};
		sessions.deleteSession = async () => {
			throw new Error("also broken");
		};
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const [failed] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(failed.ok).toBe(false);
		const survivor = store.list(50)[0];
		expect(survivor).toBeDefined();
		expect(
			(survivor.metadata as Record<string, unknown> | undefined)?.importedFrom,
		).toBeUndefined();
		// Rows are created terminal — never a running/pid-0 state that the
		// stale-session reconciler could flip to failed mid-import.
		expect(survivor.status).toBe("completed");
		const rediscovered = await importer.discover();
		expect(rediscovered[0].alreadyImportedSessionId).toBeUndefined();
	});

	it("never duplicates a source session that was already imported", async () => {
		const projectsDir = tempDir("cc-import-");
		writeClaudeCodeFixture(projectsDir);
		const dbDir = tempDir("cline-db-");
		const artifactsDir = tempDir("cline-sessions-");
		const store = sessionStore(dbDir);
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const importer = new SessionImportService(sessions, [
			new ClaudeCodeImportAdapter({ projectsDir }),
		]);

		const [first] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
		]);
		// Same request again — from a stale picker, a double click, whatever —
		// resolves to the existing session instead of writing a second copy.
		const [second, third] = await importer.importMany([
			{ tool: "claude-code", sourceId: "abc" },
			{ tool: "claude-code", sourceId: "abc" },
		]);
		expect(second.ok).toBe(true);
		expect(second.alreadyImported).toBe(true);
		expect(second.sessionId).toBe(first.sessionId);
		expect(third.sessionId).toBe(first.sessionId);
		expect(store.list(50)).toHaveLength(1);
	});
});
