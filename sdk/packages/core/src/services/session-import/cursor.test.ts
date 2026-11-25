import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it } from "vitest";
import { CoreSessionService } from "../../session/services/session-service";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import { CursorImportAdapter, cursorProviderForModel } from "./cursor";
import {
	CURSOR_TOOL_RESULT_MAX_CHARS,
	CURSOR_TRUNCATED_SUFFIX,
} from "./cursor-db";
import {
	IMPORT_MISSING_TOOL_RESULT_TEXT,
	sanitizeImportedMessages,
} from "./sanitize";
import { SessionImportService } from "./service";
import {
	openSqliteReadOnly,
	READ_ONLY_UNAVAILABLE_MESSAGE,
	sqliteFileUri,
} from "./sqlite-readonly";

const tempDirs: string[] = [];
const openStores: SqliteSessionStore[] = [];
const adapters: CursorImportAdapter[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function sessionStore(sessionsDir: string): SqliteSessionStore {
	const store = new SqliteSessionStore({ sessionsDir });
	store.init();
	openStores.push(store);
	return store;
}

function adapter(
	options: ConstructorParameters<typeof CursorImportAdapter>[0],
) {
	const instance = new CursorImportAdapter(options);
	adapters.push(instance);
	return instance;
}

afterEach(() => {
	while (adapters.length > 0) adapters.pop()?.dispose();
	while (openStores.length > 0) openStores.pop()?.close();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function blocks(message: { content: unknown }): Array<Record<string, unknown>> {
	return message.content as Array<Record<string, unknown>>;
}

const T0 = 1767600000000;
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const uuid = (n: string) =>
	`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const C1 = uuid("1");
const C2 = uuid("2");
const C3 = uuid("3");
const C4 = uuid("4");
const C5 = uuid("5");
const C6 = uuid("6");
const C7 = uuid("7");
const C8 = uuid("8");
const C9 = uuid("9");
const WS1 = "a".repeat(32);
const WS2 = "b".repeat(32);

type Bubble = Record<string, unknown>;
const bubble = (type: 1 | 2, fields: Bubble = {}): Bubble => ({
	_v: 3,
	type,
	text: "",
	createdAt: "",
	tokenCount: { inputTokens: 0, outputTokens: 0 },
	images: [],
	codeBlocks: [],
	conversationState: "~FAKE-STATE",
	...fields,
});
const tool = (fields: Bubble, extra: Bubble = {}): Bubble =>
	bubble(2, {
		capabilityType: 15,
		toolFormerData: {
			toolCallBinary: "FAKE-BINARY",
			status: "completed",
			...fields,
		},
		...extra,
	});

function composer(
	id: string,
	bubbles: Array<[string, Bubble]>,
	extra: Record<string, unknown> = {},
) {
	return {
		id,
		bubbles,
		head: {
			_v: 18,
			composerId: id,
			createdAt: T0,
			fullConversationHeadersOnly: bubbles.map(([bubbleId, b]) => ({
				bubbleId,
				type: b.type,
				...(b.createdAt ? { createdAt: b.createdAt } : {}),
			})),
			modelConfig: { modelName: "composer-2" },
			codeBlockData: {},
			originalFileStates: {},
			blobEncryptionKey: "FAKE-BLOB-KEY",
			speculativeSummarizationEncryptionKey: "FAKE-SPEC-KEY",
			conversationState: "~FAKE-STATE",
			unifiedMode: "agent",
			...extra,
		},
	};
}

const simple = (
	id: string,
	question: string,
	answer: string,
	extra: Record<string, unknown> = {},
) =>
	composer(
		id,
		[
			["u", bubble(1, { text: question, createdAt: iso(1) })],
			["a", bubble(2, { text: answer, createdAt: iso(2) })],
		],
		extra,
	);

const BIG_RESULT = "x".repeat(CURSOR_TOOL_RESULT_MAX_CHARS + 5000);

const rich = composer(
	C1,
	[
		[
			"b1",
			bubble(1, {
				text: "<timestamp>Monday, Jan 5, 2026</timestamp>\n<user_query>Fix the build</user_query>",
				createdAt: iso(1),
				modelInfo: { modelName: "claude-4.5-opus-high-thinking" },
				tokenCount: { inputTokens: 1200, outputTokens: 0 },
			}),
		],
		[
			"b2",
			bubble(2, {
				capabilityType: 30,
				thinking: { text: "Let me look", signature: "FAKE-SIGNATURE" },
				createdAt: iso(2),
				tokenCount: { inputTokens: 1300, outputTokens: 20 },
			}),
		],
		[
			"b3",
			tool({
				toolCallId: "call_read",
				name: "read_file",
				params: '{"path":"src/a.ts"}',
				result: "export const x = 1;",
			}),
		],
		[
			"b4",
			tool({
				toolCallId: "call_edit",
				name: "edit_file",
				params: "{}",
				status: "error",
				error: "ENOENT",
			}),
		],
		[
			"b5",
			tool({
				toolCallId: "call_rej",
				name: "run_cmd",
				rawArgs: "not json",
				userDecision: "rejected",
				result: "",
			}),
		],
		[
			"b6",
			tool({
				toolCallId: "call_cancel",
				name: "search",
				params: "{}",
				status: "cancelled",
			}),
		],
		[
			"b7",
			tool({
				toolCallId: "call_big",
				name: "glob",
				params: "{}",
				result: BIG_RESULT,
			}),
		],
		[
			"b8",
			tool(
				{
					toolCallId: "call_ls",
					name: "list_dir",
					params: "{}",
					result: "a b",
				},
				{ tokenCount: { inputTokens: 1400, outputTokens: 30 } },
			),
		],
		[
			"b9",
			tool(
				{
					toolCallId: "call_todo",
					name: "todo_write",
					params: '{"todos":[]}',
					result: { todos: [] },
				},
				{ thinking: "Plan it" },
			),
		],
		["b10", bubble(2, { text: "All fixed.", createdAt: iso(1) })],
		[
			"b11",
			bubble(1, {
				images: [
					{ uuid: "img1", dimension: { width: 1, height: 1 } },
					{ uuid: "img2" },
				],
			}),
		],
		[
			"b12",
			bubble(2, {
				capabilityType: 30,
				thinking: { text: "", redactedThinking: "FAKE-REDACTED" },
			}),
		],
		[
			"b13",
			bubble(2, { capabilityType: 15, toolFormerData: { additionalData: {} } }),
		],
		["missing", bubble(2, { text: "never stored" })],
		["b15", bubble(2, { text: "Anything else?", createdAt: iso(20) })],
	],
	{
		name: "Fix the build",
		lastUpdatedAt: T0 + 30_000,
		createdOnBranch: "main",
		workspaceIdentifier: {
			id: WS1,
			uri: {
				scheme: "file",
				fsPath: "/work/demo",
				external: "file:///work/demo",
			},
		},
	},
);
rich.bubbles = rich.bubbles.filter(([id]) => id !== "missing");

const composers = [
	rich,
	simple(C2, "Rename the widget", "Renamed.", { _v: 14, name: "" }),
	simple(C3, "Beta question", "Beta answer", {
		_v: 10,
		name: "Beta",
		workspaceIdentifier: { id: WS1 },
	}),
	simple(C4, "Sub task", "Sub done", {
		name: "Subagent",
		subagentInfo: { parentComposerId: C1 },
	}),
	simple(C5, "Draft", "Draft", { name: "Draft", isDraft: true }),
	composer(C6, [], { name: "Empty" }),
	simple(C7, "Mirror", "Mirror", { name: "Claude mirror" }),
	simple(C9, "Gamma question", "Gamma answer", { name: "Gamma" }),
];

function createStoreSchema(db: SqliteDb): void {
	db.exec(`CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
		CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
		CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER,
			lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER,
			value TEXT, subagentTypeName TEXT);`);
}

function insertComposer(db: SqliteDb, c: ReturnType<typeof composer>): void {
	const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
	put.run(`composerData:${c.id}`, JSON.stringify(c.head));
	for (const [bubbleId, b] of c.bubbles)
		put.run(`bubbleId:${c.id}:${bubbleId}`, JSON.stringify(b));
}

function writeCursorFixture(
	home: string,
	options: { wal?: boolean } = {},
): {
	userDir: string;
	dbPath: string;
	writer?: SqliteDb;
} {
	const userDir = join(home, "cursor-user");
	const dbPath = join(userDir, "globalStorage", "state.vscdb");
	const db = loadSqliteDb(dbPath);
	if (options.wal)
		db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
	createStoreSchema(db);
	for (const c of composers) insertComposer(db, c);
	insertComposer(db, {
		...simple(C8, "gone", "gone", { name: "Pruned" }),
		bubbles: [],
	});
	const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
	put.run(
		"composerData:empty-state-draft",
		JSON.stringify({ _v: 18, createdAt: T0, fullConversationHeadersOnly: [] }),
	);
	put.run("agentKv:blob:deadbeef", "FAKE-AGENT-BLOB");
	const item = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
	item.run("secret:fake", "FAKE-SECRET");
	item.run("cursorAuth/accessToken", "FAKE-AUTH");
	item.run(
		"glass.claudeCodeSessionRegistry.v1",
		JSON.stringify({
			archivedSessions: {},
			composerAssociations: {
				"cc-1": [
					{
						associatedAt: T0,
						localComposerId: C7,
						sourceFilePath: "/work/cc.jsonl",
					},
				],
			},
		}),
	);
	const header = db.prepare(
		`INSERT INTO composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, value)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	header.run(
		C2,
		"empty-window",
		T0,
		T0 + 5000,
		1,
		0,
		T0,
		JSON.stringify({
			composerId: C2,
			workspaceIdentifier: {
				id: "empty-window",
				uri: { scheme: "file", fsPath: "/work/alpha" },
			},
		}),
	);
	header.run(
		C4,
		WS1,
		T0,
		null,
		0,
		1,
		T0,
		JSON.stringify({ composerId: C4, name: "Subagent" }),
	);
	if (!options.wal) db.close?.();

	for (const [ws, folder] of [
		[WS1, "file:///work/beta"],
		[WS2, "file:///work/gamma"],
	]) {
		mkdirSync(join(userDir, "workspaceStorage", ws), { recursive: true });
		writeFileSync(
			join(userDir, "workspaceStorage", ws, "workspace.json"),
			JSON.stringify({ folder }),
		);
	}
	mkdirSync(join(userDir, "workspaceStorage", "empty-window"), {
		recursive: true,
	});
	const wsDb = loadSqliteDb(
		join(userDir, "workspaceStorage", WS2, "state.vscdb"),
	);
	wsDb.exec(
		"CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
	);
	wsDb
		.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
		.run(
			"composer.composerData",
			JSON.stringify({ allComposers: [{ composerId: C9, name: "Gamma" }] }),
		);
	wsDb.close?.();
	return { userDir, dbPath, writer: options.wal ? db : undefined };
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("CursorImportAdapter discovery", () => {
	it("lists store composers once and applies every filter", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		const importer = adapter(fixture);
		expect(importer.isInstalled()).toBe(true);

		const discovered = importer.discover();
		const byId = new Map(
			discovered.map((summary) => [summary.sourceId, summary]),
		);
		expect([...byId.keys()].sort()).toEqual([C1, C2, C3, C9].sort());
		expect(discovered).toHaveLength(4);
		expect(discovered.every((summary) => summary.tool === "cursor")).toBe(true);

		const c1 = byId.get(C1);
		expect(c1).toMatchObject({
			sourcePath: fixture.dbPath,
			title: "Fix the build",
			cwd: "/work/demo",
			startedAtMs: T0,
			updatedAtMs: T0 + 30_000,
			messageCount: 15,
		});
		expect(byId.get(C2)).toMatchObject({
			title: "Rename the widget",
			cwd: "/work/alpha",
			updatedAtMs: T0 + 5000,
		});
		expect(byId.get(C3)?.cwd).toBe("/work/beta");
		expect(byId.get(C9)?.cwd).toBe("/work/gamma");
		expect(byId.has(C8)).toBe(false);
		expect(() => importer.convert(C8)).toThrow(
			`Cursor session ${C8} not found`,
		);
	});

	it("is not installed without a composer store", () => {
		const home = tempDir("cursor-import-");
		const importer = adapter({ userDir: join(home, "nope") });
		expect(importer.isInstalled()).toBe(false);
		expect(importer.discover()).toEqual([]);
		expect(() => importer.convert(C1)).toThrow(
			`Cursor session ${C1} not found`,
		);
	});
});

describe("CursorImportAdapter conversion", () => {
	it("maps bubbles to paired tool turns with clean thinking and capped results", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		const converted = adapter(fixture).convert(C1);

		expect(converted).toMatchObject({
			tool: "cursor",
			sourceId: C1,
			sourcePath: fixture.dbPath,
			title: "Fix the build",
			prompt: "Fix the build",
			provider: "anthropic",
			model: "claude-4.5-opus-high-thinking",
			cwd: "/work/demo",
			gitBranch: "main",
			startedAtMs: T0,
			endedAtMs: T0 + 30_000,
		});
		const roles = converted.messages.map((message) => message.role);
		expect(roles).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		]);

		expect(blocks(converted.messages[0])).toEqual([
			{ type: "text", text: "Fix the build" },
		]);

		const turn = blocks(converted.messages[1]);
		expect(turn.map((block) => block.type)).toEqual([
			"thinking",
			...Array(6).fill("tool_use"),
		]);
		expect(turn[0]).toEqual({ type: "thinking", thinking: "Let me look" });
		expect(turn.slice(1).map((block) => block.id)).toEqual([
			"call_read",
			"call_edit",
			"call_rej",
			"call_cancel",
			"call_big",
			"call_ls",
		]);
		expect(turn[1].input).toEqual({ path: "src/a.ts" });
		expect(turn[3].input).toEqual({ arguments: "not json" });
		expect(converted.messages[1].modelInfo).toEqual({
			id: "claude-4.5-opus-high-thinking",
			provider: "anthropic",
		});
		expect(converted.messages[1].metrics).toMatchObject({
			inputTokens: 1400,
			outputTokens: 50,
		});

		const results = blocks(converted.messages[2]);
		expect(results.map((block) => block.tool_use_id)).toEqual([
			"call_read",
			"call_edit",
			"call_rej",
			"call_big",
			"call_ls",
		]);
		expect(results[0]).toMatchObject({
			type: "tool_result",
			name: "read_file",
			content: "export const x = 1;",
		});
		expect(results[1]).toMatchObject({ content: "ENOENT", is_error: true });
		expect(results[2]).toMatchObject({
			content: "[import] Tool call was rejected by the user.",
			is_error: true,
		});
		expect(
			(results[3].content as string).endsWith(CURSOR_TRUNCATED_SUFFIX),
		).toBe(true);
		expect((results[3].content as string).length).toBe(
			CURSOR_TOOL_RESULT_MAX_CHARS + CURSOR_TRUNCATED_SUFFIX.length,
		);

		expect(blocks(converted.messages[3]).map((block) => block.type)).toEqual([
			"thinking",
			"tool_use",
		]);
		expect(blocks(converted.messages[4])[0]).toMatchObject({
			tool_use_id: "call_todo",
			content: '{"todos":[]}',
		});
		expect(blocks(converted.messages[5])).toEqual([
			{ type: "text", text: "All fixed." },
		]);
		expect(blocks(converted.messages[6])).toEqual([
			{ type: "text", text: "[import] 2 image attachment(s) not imported" },
		]);
		expect(blocks(converted.messages[7])).toEqual([
			{ type: "text", text: "Anything else?" },
		]);

		const stamps = converted.messages.map(
			(message) => message.ts ?? Number.NaN,
		);
		expect(
			stamps.every(
				(ts, i) =>
					Number.isFinite(ts) && ts >= T0 && (i === 0 || ts >= stamps[i - 1]),
			),
		).toBe(true);
		expect(stamps.at(-1)).toBe(T0 + 20_000);

		const sanitized = sanitizeImportedMessages(converted.messages);
		const repaired = blocks(sanitized[2]);
		expect(repaired.map((block) => block.tool_use_id)).toEqual([
			"call_read",
			"call_edit",
			"call_rej",
			"call_cancel",
			"call_big",
			"call_ls",
		]);
		expect(repaired[3].content).toBe(IMPORT_MISSING_TOOL_RESULT_TEXT);

		const serialized = JSON.stringify(converted);
		for (const secret of [
			"FAKE-SIGNATURE",
			"FAKE-REDACTED",
			"FAKE-BINARY",
			"FAKE-STATE",
			"FAKE-BLOB-KEY",
			"FAKE-SPEC-KEY",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});

	it("handles malformed rows, per-turn models, result-less tools and edge results", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		const db = loadSqliteDb(fixture.dbPath);
		const CE = uuid("e");
		const CF = uuid("f");
		const surrogateResult = `${"y".repeat(CURSOR_TOOL_RESULT_MAX_CHARS - 1)}😀tail`;
		insertComposer(
			db,
			composer(
				CE,
				[
					[
						"u1",
						bubble(1, {
							text: "<timestamp>Tue</timestamp>\n<user_query>Tidy the repo</user_query>",
							createdAt: iso(1),
							modelInfo: { modelName: "gpt-5.2-codex" },
						}),
					],
					[
						"t1",
						tool({
							toolCallId: "call_noresult",
							name: "ripgrep",
							params: "{}",
						}),
					],
					["a1", bubble(2, { text: "Found nothing.", createdAt: iso(2) })],
					[
						"t2",
						tool({
							toolCallId: "call_empty",
							name: "run",
							params: "{}",
							result: "",
						}),
					],
					[
						"t3",
						tool({
							toolCallId: "call_emoji",
							name: "read",
							params: "{}",
							result: surrogateResult,
						}),
					],
					["bad", bubble(2, { text: "replaced below" })],
					[
						"u2",
						bubble(1, {
							text: "Now with Claude",
							createdAt: iso(3),
							modelInfo: { modelName: "claude-4.5-sonnet" },
						}),
					],
					["a2", bubble(2, { text: "On it.", createdAt: iso(4) })],
				],
				{ name: "" },
			),
		);
		db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(
			"{not json",
			`bubbleId:${CE}:bad`,
		);
		db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
			`composerData:${CF}`,
			"{broken",
		);
		db.close?.();

		const importer = adapter(fixture);
		const discovered = importer.discover();
		expect(discovered.map((summary) => summary.sourceId)).toContain(C1);
		expect(discovered.map((summary) => summary.sourceId)).not.toContain(CF);
		expect(discovered.find((summary) => summary.sourceId === CE)?.title).toBe(
			"Tidy the repo",
		);

		const converted = importer.convert(CE);
		expect(converted.model).toBe("gpt-5.2-codex");
		expect(converted.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"assistant",
			"user",
			"user",
			"assistant",
		]);
		expect(blocks(converted.messages[1]).map((block) => block.id)).toEqual([
			"call_noresult",
		]);
		expect(blocks(converted.messages[2])).toEqual([
			{ type: "text", text: "Found nothing." },
			expect.objectContaining({ id: "call_empty" }),
			expect.objectContaining({ id: "call_emoji" }),
		]);
		const results = blocks(converted.messages[3]);
		expect(results.map((block) => block.tool_use_id)).toEqual(["call_emoji"]);
		const capped = results[0].content as string;
		expect(capped.endsWith(CURSOR_TRUNCATED_SUFFIX)).toBe(true);
		const body = capped.slice(0, -CURSOR_TRUNCATED_SUFFIX.length);
		const lastUnit = body.charCodeAt(body.length - 1);
		expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
		expect(
			converted.messages
				.flatMap(blocks)
				.some(
					(block) => block.type === "tool_result" && block.content === '""',
				),
		).toBe(false);
		expect(converted.messages[1].modelInfo?.id).toBe("gpt-5.2-codex");
		expect(converted.messages[5].modelInfo?.id).toBe("claude-4.5-sonnet");
	});

	it("maps model slugs to providers", () => {
		expect(cursorProviderForModel("claude-4.5-opus-high-thinking")).toBe(
			"anthropic",
		);
		expect(cursorProviderForModel("gpt-5.2-codex")).toBe("openai-native");
		expect(cursorProviderForModel("o3")).toBe("openai-native");
		expect(cursorProviderForModel("gemini-3-flash")).toBe("gemini");
		expect(cursorProviderForModel("composer-2")).toBe("cursor");
		expect(cursorProviderForModel("default")).toBe("cursor");
	});
});

describe("CursorImportAdapter store access", () => {
	it("never creates side files or changes a closed store", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		const before = {
			hash: sha256(fixture.dbPath),
			mtime: statSync(fixture.dbPath).mtimeMs,
		};
		const importer = adapter(fixture);
		importer.discover();
		for (const id of [C1, C2, C9]) importer.convert(id);
		importer.dispose();

		expect(readdirSync(join(fixture.userDir, "globalStorage"))).toEqual([
			"state.vscdb",
		]);
		expect(sha256(fixture.dbPath)).toBe(before.hash);
		expect(statSync(fixture.dbPath).mtimeMs).toBe(before.mtime);

		const handle = openSqliteReadOnly(fixture.dbPath);
		expect(handle.mode).toBe("immutable");
		expect(() =>
			handle.db.exec("INSERT INTO ItemTable (key, value) VALUES ('x', 'y')"),
		).toThrow();
		handle.close();

		const opener = fileURLToPath(
			new URL("./sqlite-readonly.ts", import.meta.url),
		);
		const script = `import { openSqliteReadOnly } from ${JSON.stringify(opener)};
const handle = openSqliteReadOnly(${JSON.stringify(fixture.dbPath)});
let rejected = false;
try { handle.db.exec("INSERT INTO ItemTable (key, value) VALUES ('x', 'y')"); } catch { rejected = true; }
const n = handle.db.prepare("SELECT count(*) AS n FROM cursorDiskKV WHERE key >= ? AND key < ?").get("composerData:", "composerData;").n;
handle.close();
console.log(JSON.stringify({ mode: handle.mode, n, rejected }));`;
		expect(
			JSON.parse(
				execFileSync("bun", ["-e", script], { encoding: "utf8" }).trim(),
			),
		).toEqual({
			mode: "immutable",
			n: composers.length + 2,
			rejected: true,
		});
	});

	it("reads uncheckpointed rows from a live WAL store without touching db or wal", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"), {
			wal: true,
		});
		const writer = fixture.writer as SqliteDb;
		try {
			insertComposer(
				writer,
				simple(uuid("d"), "Live question", "Live answer", { name: "Live" }),
			);
			expect(existsSync(`${fixture.dbPath}-wal`)).toBe(true);
			const before = [fixture.dbPath, `${fixture.dbPath}-wal`].map(sha256);

			const handle = openSqliteReadOnly(fixture.dbPath);
			expect(handle.mode).toBe("wal-reader");
			expect(() =>
				handle.db.exec("INSERT INTO ItemTable (key, value) VALUES ('x', 'y')"),
			).toThrow();
			handle.close();

			const importer = adapter(fixture);
			expect(importer.discover().map((summary) => summary.title)).toContain(
				"Live",
			);
			expect(importer.convert(uuid("d")).messages).toHaveLength(2);
			importer.dispose();
			expect([fixture.dbPath, `${fixture.dbPath}-wal`].map(sha256)).toEqual(
				before,
			);
		} finally {
			writer.close?.();
		}
	});

	it("refuses a corrupt store without creating side files when there is no -wal", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"), {
			wal: true,
		});
		(fixture.writer as SqliteDb).close?.();
		expect(readdirSync(join(fixture.userDir, "globalStorage"))).toEqual([
			"state.vscdb",
		]);
		// Damage the page-1 b-tree header of a WAL-mode database.
		const bytes = readFileSync(fixture.dbPath);
		bytes.fill(0xff, 100, 108);
		writeFileSync(fixture.dbPath, bytes);

		expect(() => openSqliteReadOnly(fixture.dbPath)).toThrow();
		expect(readdirSync(join(fixture.userDir, "globalStorage"))).toEqual([
			"state.vscdb",
		]);
	});

	it("refuses a -wal without -shm instead of creating -shm", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"), {
			wal: true,
		});
		(fixture.writer as SqliteDb).close?.();
		writeFileSync(`${fixture.dbPath}-wal`, "");
		expect(() => openSqliteReadOnly(fixture.dbPath)).toThrow(
			READ_ONLY_UNAVAILABLE_MESSAGE,
		);
		expect(readdirSync(join(fixture.userDir, "globalStorage")).sort()).toEqual([
			"state.vscdb",
			"state.vscdb-wal",
		]);
	});

	it("builds file URIs without an authority for UNC paths", () => {
		expect(
			sqliteFileUri(new URL("file://server/share/User/state.vscdb"), "mode=ro"),
		).toBe("file:////server/share/User/state.vscdb?mode=ro");
		expect(
			sqliteFileUri(new URL("file:///Users/me/state.vscdb"), "mode=ro"),
		).toBe("file:///Users/me/state.vscdb?mode=ro");
	});

	it("surfaces a store-open error", () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		writeFileSync(fixture.dbPath, "definitely not a database");
		const importer = adapter(fixture);
		expect(importer.isInstalled()).toBe(true);
		expect(() => importer.discover()).toThrow(
			"Cursor composer store could not be opened",
		);
		expect(() => importer.convert(C2)).toThrow(
			"Cursor composer store could not be opened",
		);
	});
});

describe("SessionImportService with cursor", () => {
	it("imports a composer into a completed session and dedupes re-imports", async () => {
		const fixture = writeCursorFixture(tempDir("cursor-import-"));
		const store = sessionStore(tempDir("cline-db-"));
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: tempDir("cline-sessions-"),
		});
		const importer = new SessionImportService(sessions, [adapter(fixture)]);

		const discovered = await importer.discover();
		expect(
			discovered.find((s) => s.sourceId === C1)?.alreadyImportedSessionId,
		).toBeUndefined();
		const [result] = await importer.importMany([
			{ tool: "cursor", sourceId: C1 },
		]);
		expect(result.ok).toBe(true);
		const sessionId = result.sessionId as string;
		expect(sessionId.startsWith(String(T0))).toBe(true);
		const row = store.get(sessionId);
		expect(row).toMatchObject({
			status: "completed",
			provider: "anthropic",
			cwd: "/work/demo",
		});
		const metadata = row?.metadata as Record<string, Record<string, unknown>>;
		expect(metadata.sessionHistoryOrigin).toEqual({
			mode: "import",
			trigger: "cursor",
		});
		expect(metadata.importedFrom).toMatchObject({
			tool: "cursor",
			sourceSessionId: C1,
			sourcePath: fixture.dbPath,
		});
		const payload = JSON.parse(readFileSync(row?.messagesPath ?? "", "utf8"));
		expect(payload.messages.length).toBeGreaterThan(0);
		expect(JSON.stringify(payload)).not.toContain("FAKE-");
		expect(
			(await importer.discover()).find((s) => s.sourceId === C1)
				?.alreadyImportedSessionId,
		).toBe(sessionId);
		const [again] = await importer.importMany([
			{ tool: "cursor", sourceId: C1 },
		]);
		expect(again).toMatchObject({ ok: true, alreadyImported: true, sessionId });
		expect(
			store.list(50).filter((entry) => entry.sessionId === sessionId),
		).toHaveLength(1);
	});
});
