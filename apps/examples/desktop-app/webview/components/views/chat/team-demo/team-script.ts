import type { ChatSessionStatus } from "@/lib/chat-schema";

/*
 * Scripted agent team run: a lead session that plans, delegates, and routes
 * findings with the real team tools, and one child session per teammate. Tool
 * names, inputs, and results follow the SDK team tools so the transcripts and
 * the header's agent roster render exactly as they do for a live run.
 */

export const TEAM_NAME = "tidepool-realtime";
export const LEAD = "lead";
export const TEAMMATE_IDS = [
	"architect",
	"server-dev",
	"client-dev",
	"presence-dev",
	"test-engineer",
	"reviewer",
] as const;
export type TeammateId = (typeof TEAMMATE_IDS)[number];
export type SessionKey = typeof LEAD | TeammateId;

export type TeammatePhase =
	| "planning"
	| "editing"
	| "testing"
	| "reviewing"
	| "waiting"
	| "done";

export const TITLE = "Add real-time collaboration to the board";
export const PROMPT =
	"Add real-time collaboration to the Tidepool board: card edits and moves should sync live across open tabs, show who else is viewing the board, and resolve concurrent reorders without conflicts. Include tests and a short design doc. Break it up across a team.";

export type Teammate = {
	id: TeammateId;
	runId: string;
	title: string;
	role: string;
	task: string;
};

export const TEAMMATES: Record<TeammateId, Teammate> = {
	architect: {
		id: "architect",
		runId: "run_1a7c40",
		title: "Design the sync protocol and ordering model",
		role: "You design protocols and data models before code is written.",
		task: "Design the real-time sync protocol: event shape, versioning, reconnect behavior, and how card order survives concurrent moves. Write it up in docs/realtime.md and tell the team when it is ready.",
	},
	"server-dev": {
		id: "server-dev",
		runId: "run_5e02b9",
		title: "Build the WebSocket hub and event persistence",
		role: "You own the Bun server and its storage.",
		task: "Add a WebSocket hub to the server that applies and broadcasts board events per board, persists them, and replays missed events on reconnect. Follow docs/realtime.md once architect publishes it; read the server code while you wait.",
	},
	"client-dev": {
		id: "client-dev",
		runId: "run_92d4e1",
		title: "Replace polling with an optimistic sync store",
		role: "You own client state and networking.",
		task: "Replace the 5-second polling with a sync store: apply edits and moves optimistically, send them over the socket, and roll back on rejection. Follow docs/realtime.md once it lands; map the current mutations while you wait.",
	},
	"presence-dev": {
		id: "presence-dev",
		runId: "run_c3b817",
		title: "Show who is viewing the board",
		role: "You own board UI.",
		task: "Show who else is viewing the board using the presence events from docs/realtime.md. Reuse the existing avatar stack and design tokens.",
	},
	"test-engineer": {
		id: "test-engineer",
		runId: "run_e8f056",
		title: "Write multi-client sync tests",
		role: "You write tests that exercise real behavior.",
		task: "Write tests that run two clients against one server: edits, moves, concurrent moves into the same slot, reconnect replay, and presence. Plan the matrix now and write the tests once the protocol lands.",
	},
	reviewer: {
		id: "reviewer",
		runId: "run_07a6d3",
		title: "Review each change as it lands",
		role: "You review code for correctness against the design.",
		task: "Review each teammate's change against docs/realtime.md as it lands. Approve, or send concrete findings to the owner or the main session.",
	},
};

export const FINAL_DIFF = { additions: 1184, deletions: 212 };

const LEAD_PLAN = `Tidepool polls the API every 5 seconds and stores card order as integer positions, so this is a protocol change first and code second. I'll split it six ways:

1. **architect**: event protocol and ordering model. Everything else builds on this.
2. **server-dev**: WebSocket hub and event persistence
3. **client-dev**: optimistic sync store to replace polling
4. **presence-dev**: who's viewing, in the existing avatar stack
5. **test-engineer**: two-client sync tests
6. **reviewer**: reviews each change as it lands

The builders plan against the current code until the protocol is ready.`;

const LEAD_FINAL = `Real-time collaboration is in. Six teammates built it in parallel; I planned the split, routed one review finding, and ran the full suite.

- **architect** wrote \`docs/realtime.md\`: versioned events over one WebSocket, and fractional indexes so a move touches one card
- **server-dev** added the hub in \`server/realtime.ts\` with per-board rooms and replay on reconnect
- **client-dev** replaced 5-second polling with an optimistic sync store that rolls back on rejection
- **presence-dev** shows who's viewing the board in the existing avatar stack
- **test-engineer** found that concurrent moves into one slot diverged, and added a deterministic tiebreak
- **reviewer** caught moves still sending integer positions before client-dev landed

38 tests pass.`;

type BeatAction =
	| { status: ChatSessionStatus }
	/** Opens a teammate's session with its task as the first message. */
	| { start: true }
	| {
			say: string;
			reasoning?: string;
			/** Model time spent thinking, so "Thought for…" reads like a real turn. */
			thinkMs?: number;
			stream?: boolean;
	  }
	/** A tool call. With `ref` it stays running until a matching `complete`. */
	| {
			tool: string;
			input: unknown;
			result?: unknown;
			runMs?: number;
			ref?: string;
	  }
	| { complete: string; result: unknown }
	| { note: true };

export type Beat = {
	wait: number;
	in: SessionKey;
	/** What a teammate is doing from this beat on, as shown in the team panel. */
	phase?: TeammatePhase;
	step?: string;
} & BeatAction;

const commandResult = (query: string, result: string) => [{ query, result }];

const runSummary = (teammate: Teammate, status = "completed") => ({
	id: teammate.runId,
	agentId: teammate.id,
	status,
});

const mail = (
	id: string,
	from: SessionKey,
	to: SessionKey,
	subject: string,
) => [{ id, fromAgentId: from, toAgentId: to, subject }];

export function buildBeats(): Beat[] {
	const all = TEAMMATE_IDS.map((id) => TEAMMATES[id]);
	const architect = TEAMMATES.architect;
	const server = TEAMMATES["server-dev"];

	return [
		{ wait: 500, in: LEAD, status: "running" },
		{
			wait: 500,
			in: LEAD,
			reasoning:
				"Live sync touches the server, client state, the board UI, and ordering. I need to see how data flows today before deciding how to split it.",
			thinkMs: 4000,
			say: "I'll map how the board loads and saves data before splitting this up.",
		},
		{
			wait: 300,
			in: LEAD,
			tool: "read_files",
			input: {
				files: [
					"src/api.js",
					"src/board.js",
					"server/index.ts",
					"server/db.ts",
				],
			},
			result: "ok",
			runMs: 700,
		},
		{
			wait: 200,
			in: LEAD,
			tool: "search_codebase",
			input: { queries: ["setInterval", "position", "PATCH /cards"] },
			result:
				"src/board.js:22 setInterval(fetchBoard, 5000)\nserver/db.ts:31 position INTEGER NOT NULL\nserver/index.ts:58 PATCH /cards/:id",
			runMs: 500,
		},
		{
			wait: 500,
			in: LEAD,
			reasoning:
				"The protocol is the critical path: the server, client, presence, and tests all depend on the event shape and the ordering model. One agent should design it while the others learn their part of the codebase, so nobody idles and nobody builds against a guess. A reviewer running alongside catches drift from the design before it compounds.",
			thinkMs: 11000,
			say: LEAD_PLAN,
			stream: true,
		},
		...all.map(
			(teammate): Beat => ({
				wait: 110,
				in: LEAD,
				tool: "team_spawn_teammate",
				input: { agentId: teammate.id, rolePrompt: teammate.role },
				result: { agentId: teammate.id, status: "spawned" },
				runMs: 200,
			}),
		),
		...all.flatMap((teammate): Beat[] => [
			{
				wait: 90,
				in: LEAD,
				tool: "team_run_task",
				input: { agentId: teammate.id, task: teammate.task, runMode: "async" },
				result: {
					agentId: teammate.id,
					mode: "async",
					status: "queued",
					dispatched: true,
					message: `Task dispatched to ${teammate.id} and queued as ${teammate.runId}.`,
					runId: teammate.runId,
				},
				runMs: 180,
			},
			{
				wait: 40,
				in: teammate.id,
				start: true,
				phase: teammate.id === "reviewer" ? "waiting" : "planning",
				step: "Reading the task",
			},
		]),
		{
			wait: 400,
			in: LEAD,
			say: "Six teammates are running. architect is designing the protocol; the others are planning against the current code until it lands.",
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_await_runs",
			input: { runId: architect.runId },
			ref: "await-architect",
		},

		// Everyone plans while architect designs the protocol.
		{
			wait: 300,
			in: "architect",
			step: "Comparing ordering strategies",
			reasoning:
				"Two decisions everything else depends on: the event shape, and how card order survives concurrent moves. Integer positions mean a move rewrites every card after it, and two concurrent moves fight over the same rows. Fractional indexes let a move write one card.",
			thinkMs: 9000,
			say: "Starting with the two decisions everything depends on: the event shape, and how card order survives concurrent moves.",
		},
		{
			wait: 250,
			in: "server-dev",
			step: "Reading the server's persistence layer",
			say: "While the protocol is drafted, I'll learn how the server stores and updates cards.",
		},
		{
			wait: 200,
			in: "client-dev",
			step: "Mapping every board mutation",
			say: "Mapping every place the board mutates state, so each one can become an optimistic update.",
		},
		{
			wait: 200,
			in: "presence-dev",
			step: "Planning around the avatar stack",
			reasoning:
				"The header already renders an avatar stack for assignees. Presence should reuse it with a live ring, rather than add a new widget.",
			thinkMs: 5000,
			say: "Presence should reuse the header's avatar stack. Checking how it's built.",
		},
		{
			wait: 200,
			in: "server-dev",
			tool: "read_files",
			input: { files: ["server/index.ts", "server/db.ts"] },
			result: "ok",
			runMs: 500,
		},
		{
			wait: 150,
			in: "reviewer",
			step: "Waiting for the first change",
			say: "Nothing to review yet. I'll read the current sync path so I can review changes against it.",
		},
		{
			wait: 200,
			in: "client-dev",
			tool: "search_codebase",
			input: { queries: ["fetch(", "renderBoard", "moveCard"] },
			result:
				"src/api.js:8 fetch(boardUrl(id))\nsrc/board.js:22 setInterval(fetchBoard, 5000)\nsrc/board.js:71 moveCard(id, toIndex)",
			runMs: 500,
		},
		{
			wait: 200,
			in: "test-engineer",
			step: "Drafting the test matrix",
			say: `Test plan, two clients against one server:

- An edit on A appears on B
- A move on A appears on B in the same order
- Concurrent moves into the same slot converge
- Reconnect replays missed events
- Presence join and leave`,
			stream: true,
		},
		{
			wait: 200,
			in: "presence-dev",
			tool: "search_codebase",
			input: { queries: ["avatar-stack", "renderAvatars"] },
			result: "src/header.js:14 function renderAvatars(users)",
			runMs: 450,
		},
		{
			wait: 200,
			in: "architect",
			step: "Writing docs/realtime.md",
			tool: "editor",
			input: {
				path: "docs/realtime.md",
				new_text: `# Real-time sync

One WebSocket per tab at \`/ws?board=<id>\`. The server is the source of truth.

## Events
Every event is \`{ seq, boardId, clientId, type, payload }\`. \`seq\` is assigned by
the server and strictly increases per board.

- \`card.updated\` { id, fields }
- \`card.moved\` { id, columnId, order }
- \`presence.joined\` / \`presence.left\` { userId }

## Ordering
Cards sort by a fractional index string (\`order\`). A move writes one card: the
new order sits between its neighbours. Ties sort by \`clientId\`.

## Reconnect
Clients send \`lastSeq\`; the server replays every later event before going live.`,
			},
			result: "Created docs/realtime.md",
			runMs: 1100,
		},
		{
			wait: 200,
			in: "reviewer",
			tool: "read_files",
			input: { files: ["src/board.js", "server/index.ts"] },
			result: "ok",
			runMs: 500,
		},
		{
			wait: 200,
			in: "client-dev",
			step: "Planning the store API",
			say: "Five mutations to convert: edit title, edit fields, move, create, archive. Each gets an optimistic apply and a rollback.",
		},
		{
			wait: 250,
			in: "architect",
			tool: "team_broadcast",
			input: {
				subject: "Protocol v1 is in docs/realtime.md",
				body: "Versioned events over one socket per tab, fractional-index ordering with a clientId tiebreak, replay from lastSeq on reconnect.",
			},
			result: { delivered: 5 },
			runMs: 250,
		},
		{
			wait: 250,
			in: "architect",
			say: "Protocol v1 is published in `docs/realtime.md`: versioned events over one socket, fractional indexes so a move writes one card, and replay from `lastSeq` on reconnect.",
			stream: true,
		},
		{ wait: 200, in: "architect", status: "completed" },
		{
			wait: 200,
			in: LEAD,
			complete: "await-architect",
			result: runSummary(architect),
		},
		{
			wait: 300,
			in: LEAD,
			say: "The protocol is in, and the builders are unblocked. Waiting on server-dev next, since client-dev needs a live server to test against.",
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_await_runs",
			input: { runId: server.runId },
			ref: "await-server",
		},

		// Builders act on the protocol; reviewer waits for the first change.
		{
			wait: 250,
			in: "server-dev",
			phase: "editing",
			step: "Reading the protocol",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_1",
				"architect",
				"server-dev",
				"Protocol v1 is in docs/realtime.md",
			),
			runMs: 250,
		},
		{
			wait: 150,
			in: "client-dev",
			phase: "editing",
			step: "Reading the protocol",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_1",
				"architect",
				"client-dev",
				"Protocol v1 is in docs/realtime.md",
			),
			runMs: 250,
		},
		{
			wait: 150,
			in: "presence-dev",
			phase: "editing",
			step: "Reading the protocol",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_1",
				"architect",
				"presence-dev",
				"Protocol v1 is in docs/realtime.md",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: "server-dev",
			step: "Writing server/realtime.ts",
			tool: "editor",
			input: {
				path: "server/realtime.ts",
				new_text: `const rooms = new Map<string, Set<ServerWebSocket<Client>>>();

export function open(ws: ServerWebSocket<Client>) {
	const room = rooms.get(ws.data.boardId) ?? new Set();
	rooms.set(ws.data.boardId, room.add(ws));
	for (const event of db.eventsSince(ws.data.boardId, ws.data.lastSeq)) {
		ws.send(JSON.stringify(event));
	}
	broadcast(ws.data.boardId, { type: "presence.joined", payload: { userId: ws.data.userId } });
}

export function message(ws: ServerWebSocket<Client>, raw: string) {
	const event = db.applyEvent(ws.data.boardId, ws.data.clientId, JSON.parse(raw));
	broadcast(ws.data.boardId, event);
}`,
			},
			result: "Created server/realtime.ts",
			runMs: 1000,
		},
		{
			wait: 200,
			in: "test-engineer",
			phase: "editing",
			step: "Writing tests/realtime.test.ts",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_1",
				"architect",
				"test-engineer",
				"Protocol v1 is in docs/realtime.md",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: "client-dev",
			step: "Writing src/sync/store.js",
			tool: "editor",
			input: {
				path: "src/sync/store.js",
				new_text: `export function createSyncStore(board, socket) {
	const pending = new Map();

	function apply(event) {
		const undo = board.apply(event);
		pending.set(event.id, undo);
		socket.send(event);
	}

	socket.onEvent((event) => {
		if (pending.has(event.id)) return pending.delete(event.id);
		board.apply(event);
	});

	socket.onReject((id) => {
		pending.get(id)?.();
		pending.delete(id);
	});

	return { apply };
}`,
			},
			result: "Created src/sync/store.js",
			runMs: 1000,
		},
		{
			wait: 200,
			in: "presence-dev",
			step: "Adding live presence to the avatar stack",
			tool: "editor",
			input: {
				path: "src/header.js",
				old_text: "function renderAvatars(users) {",
				new_text: `function renderAvatars(users, online = new Set()) {
	users = [...users].sort((a, b) => online.has(b.id) - online.has(a.id));`,
			},
			result: "Edited src/header.js",
			runMs: 700,
		},
		{
			wait: 200,
			in: "test-engineer",
			tool: "editor",
			input: {
				path: "tests/realtime.test.ts",
				new_text: `test("concurrent moves into the same slot converge", async () => {
	const [a, b] = await connectClients(2, { board: "launch-q4" });
	await Promise.all([
		a.move("card-1", { column: "doing", index: 0 }),
		b.move("card-2", { column: "doing", index: 0 }),
	]);
	await settle(a, b);
	expect(a.column("doing")).toEqual(b.column("doing"));
});`,
			},
			result: "Created tests/realtime.test.ts",
			runMs: 900,
		},
		{
			wait: 200,
			in: "server-dev",
			tool: "editor",
			input: {
				path: "server/index.ts",
				old_text: `fetch(req) {`,
				new_text: `websocket: realtime,
	fetch(req, server) {
		if (new URL(req.url).pathname === "/ws") return upgrade(req, server);`,
			},
			result: "Edited server/index.ts",
			runMs: 700,
		},
		{
			wait: 200,
			in: "test-engineer",
			phase: "waiting",
			step: "Waiting on server-dev and client-dev",
			say: "Five tests are written. They need the hub and the sync store, so I'll run them when both land.",
		},
		{
			wait: 200,
			in: "server-dev",
			phase: "testing",
			step: "Running server tests",
			tool: "run_commands",
			input: { commands: ["bun test server"] },
			result: commandResult(
				"bun test server",
				"✓ replays events after lastSeq\n✓ assigns increasing seq per board\n✓ broadcasts to the board's room only\n\n 9 pass\n 0 fail",
			),
			runMs: 1000,
		},
		{
			wait: 200,
			in: "presence-dev",
			step: "Styling the live ring",
			tool: "editor",
			input: {
				path: "src/styles.css",
				old_text: ".avatar {",
				new_text: `.avatar[data-online] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }

.avatar {`,
			},
			result: "Edited src/styles.css",
			runMs: 600,
		},
		{
			wait: 200,
			in: "server-dev",
			tool: "team_send_message",
			input: {
				toAgentId: "reviewer",
				subject: "Ready for review: WebSocket hub",
				body: "server/realtime.ts and the /ws upgrade in server/index.ts. 9 server tests pass.",
			},
			result: { id: "msg_2", toAgentId: "reviewer" },
			runMs: 250,
		},
		{
			wait: 200,
			in: "server-dev",
			say: "The hub is done: per-board rooms, server-assigned `seq`, and replay from `lastSeq` on reconnect. 9 tests pass, and it's with reviewer.",
			stream: true,
		},
		{ wait: 150, in: "server-dev", status: "completed" },
		{
			wait: 150,
			in: LEAD,
			complete: "await-server",
			result: runSummary(server),
		},
		{
			wait: 250,
			in: LEAD,
			say: "server-dev finished the hub, and reviewer has it. client-dev, presence-dev, and test-engineer are still going.",
		},

		// Reviewer finds a design drift; the lead routes it.
		{
			wait: 250,
			in: "reviewer",
			phase: "reviewing",
			step: "Reviewing server/realtime.ts",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_2",
				"server-dev",
				"reviewer",
				"Ready for review: WebSocket hub",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: "reviewer",
			tool: "read_files",
			input: {
				files: ["server/realtime.ts", "server/index.ts", "src/sync/store.js"],
			},
			result: "ok",
			runMs: 600,
		},
		{
			wait: 200,
			in: "presence-dev",
			phase: "testing",
			step: "Running presence tests",
			tool: "run_commands",
			input: { commands: ["bun test src/header.test.js"] },
			result: commandResult(
				"bun test src/header.test.js",
				"✓ online users sort first\n✓ marks online avatars\n\n 4 pass\n 0 fail",
			),
			runMs: 800,
		},
		{
			wait: 200,
			in: "reviewer",
			reasoning:
				"The hub matches the design: per-board rooms, server-assigned seq, replay from lastSeq. But the client store passes board.moveCard's integer index straight through, so moves would still renumber every card after the target. That defeats the ordering model, and it isn't in server-dev's diff, so it should go to the main session.",
			thinkMs: 7000,
			say: "The hub matches `docs/realtime.md`. Approved. One problem outside this diff: the client still sends integer positions on move, which would undo the ordering model.",
		},
		{
			wait: 200,
			in: "reviewer",
			tool: "team_send_message",
			input: {
				toAgentId: "lead",
				subject: "Moves still send integer positions",
				body: "src/sync/store.js forwards moveCard's integer index. Per docs/realtime.md, moves must send a fractional order between neighbours.",
			},
			result: { id: "msg_3", toAgentId: "lead" },
			runMs: 250,
		},
		{
			wait: 150,
			in: "reviewer",
			phase: "waiting",
			step: "Waiting for client-dev's change",
			note: true,
		},
		{
			wait: 200,
			in: "presence-dev",
			say: "Presence is in: viewers sort to the front of the avatar stack with a live ring, driven by `presence.joined` and `presence.left`. 4 tests pass.",
			stream: true,
		},
		{ wait: 150, in: "presence-dev", status: "completed" },
		{
			wait: 200,
			in: LEAD,
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_3",
				"reviewer",
				"lead",
				"Moves still send integer positions",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: LEAD,
			reasoning:
				"reviewer is right: forwarding the integer index means every move renumbers the column, which is exactly the conflict the protocol was designed out of. client-dev hasn't finished, so the cheapest fix is now, before tests are built on top of it.",
			thinkMs: 5000,
			say: "Good catch from reviewer. client-dev hasn't landed yet, so I'm sending it back now rather than after tests depend on it.",
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_send_message",
			input: {
				toAgentId: "client-dev",
				subject: "Use fractional order for moves",
				body: "reviewer found src/sync/store.js forwards moveCard's integer index. Compute the order between the new neighbours, per docs/realtime.md.",
			},
			result: { id: "msg_4", toAgentId: "client-dev" },
			runMs: 250,
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_await_runs",
			input: {},
			ref: "await-all",
		},
		{
			wait: 250,
			in: "client-dev",
			step: "Switching moves to fractional order",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_4",
				"lead",
				"client-dev",
				"Use fractional order for moves",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: "client-dev",
			say: "Right, I was forwarding the index from `moveCard`. Adding an order helper so a move writes one card.",
		},
		{
			wait: 200,
			in: "client-dev",
			tool: "editor",
			input: {
				path: "src/sync/order.js",
				new_text: `export function between(before, after) {
	const lo = before ? parse(before) : 0;
	const hi = after ? parse(after) : 1;
	return format((lo + hi) / 2);
}

export const compareCards = (a, b) =>
	a.order < b.order ? -1 : a.order > b.order ? 1 : 0;`,
			},
			result: "Created src/sync/order.js",
			runMs: 800,
		},
		{
			wait: 200,
			in: "client-dev",
			tool: "editor",
			input: {
				path: "src/board.js",
				old_text: `export function moveCard(id, toIndex) {\n\tapi.patch(\`/cards/\${id}\`, { position: toIndex });`,
				new_text: `export function moveCard(id, columnId, toIndex) {\n\tconst [before, after] = neighbours(columnId, toIndex);\n\tsync.apply({ type: "card.moved", payload: { id, columnId, order: between(before, after) } });`,
			},
			result: "Edited src/board.js",
			runMs: 700,
		},
		{
			wait: 200,
			in: "client-dev",
			tool: "editor",
			input: {
				path: "src/board.js",
				old_text: "setInterval(fetchBoard, 5000);",
				new_text:
					"const sync = createSyncStore(board, connect(boardId, lastSeq));",
			},
			result: "Edited src/board.js",
			runMs: 600,
		},
		{
			wait: 200,
			in: "client-dev",
			phase: "testing",
			step: "Running client tests",
			tool: "run_commands",
			input: { commands: ["bun test src/sync"] },
			result: commandResult(
				"bun test src/sync",
				"✓ applies edits optimistically\n✓ rolls back a rejected move\n✓ between() orders strictly\n\n 12 pass\n 0 fail",
			),
			runMs: 900,
		},
		{
			wait: 200,
			in: "client-dev",
			tool: "team_broadcast",
			input: {
				subject: "Sync store landed",
				body: "Polling is gone. Moves send a fractional order. 12 client tests pass.",
			},
			result: { delivered: 3 },
			runMs: 250,
		},
		{
			wait: 200,
			in: "client-dev",
			say: "The sync store is in: optimistic edits and moves with rollback, fractional order for moves, and no more polling. 12 tests pass.",
			stream: true,
		},
		{ wait: 150, in: "client-dev", status: "completed" },

		// Tests catch a real convergence bug; test-engineer fixes it.
		{
			wait: 250,
			in: "test-engineer",
			phase: "testing",
			step: "Running two-client tests",
			tool: "run_commands",
			input: { commands: ["bun test tests/realtime.test.ts"] },
			result: commandResult(
				"bun test tests/realtime.test.ts",
				`✓ an edit on A appears on B
✓ a move on A appears on B in the same order
✗ concurrent moves into the same slot converge
  expected ["card-2", "card-1"]
  received ["card-1", "card-2"] on client B
✓ reconnect replays missed events
✓ presence join and leave

 4 pass
 1 fail`,
			),
			runMs: 1100,
		},
		{
			wait: 200,
			in: "reviewer",
			phase: "reviewing",
			step: "Reviewing src/sync and src/board.js",
			tool: "read_files",
			input: {
				files: ["src/sync/store.js", "src/sync/order.js", "src/board.js"],
			},
			result: "ok",
			runMs: 600,
		},
		{
			wait: 200,
			in: "test-engineer",
			step: "Fixing the tie in compareCards",
			reasoning:
				"Both clients compute the same order between the same neighbours, so the two cards tie. The design says ties sort by clientId, but compareCards returns 0, so each client keeps arrival order and they disagree.",
			thinkMs: 6000,
			say: "One real bug: two moves into the same slot get the same order, and ties fall back to arrival order, so clients disagree. The design says ties sort by `clientId`; `compareCards` doesn't.",
		},
		{
			wait: 200,
			in: "test-engineer",
			phase: "editing",
			tool: "editor",
			input: {
				path: "src/sync/order.js",
				old_text: "a.order < b.order ? -1 : a.order > b.order ? 1 : 0;",
				new_text:
					"a.order < b.order ? -1 : a.order > b.order ? 1 : a.clientId.localeCompare(b.clientId);",
			},
			result: "Edited src/sync/order.js",
			runMs: 600,
		},
		{
			wait: 200,
			in: "reviewer",
			say: "Client changes match the design now: moves send a fractional order, and rollback restores the previous order. Approved.",
		},
		{
			wait: 200,
			in: "test-engineer",
			phase: "testing",
			tool: "run_commands",
			input: { commands: ["bun test tests/realtime.test.ts"] },
			result: commandResult(
				"bun test tests/realtime.test.ts",
				"✓ an edit on A appears on B\n✓ a move on A appears on B in the same order\n✓ concurrent moves into the same slot converge\n✓ reconnect replays missed events\n✓ presence join and leave\n\n 5 pass\n 0 fail",
			),
			runMs: 1000,
		},
		{
			wait: 200,
			in: "test-engineer",
			tool: "team_send_message",
			input: {
				toAgentId: "reviewer",
				subject: "Tiebreak fix in src/sync/order.js",
				body: "compareCards now breaks ties by clientId, per docs/realtime.md. All 5 two-client tests pass.",
			},
			result: { id: "msg_5", toAgentId: "reviewer" },
			runMs: 250,
		},
		{
			wait: 200,
			in: "test-engineer",
			say: "All 5 two-client tests pass, including concurrent moves into one slot after the `clientId` tiebreak fix.",
			stream: true,
		},
		{ wait: 150, in: "test-engineer", status: "completed" },
		{
			wait: 250,
			in: "reviewer",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: mail(
				"msg_5",
				"test-engineer",
				"reviewer",
				"Tiebreak fix in src/sync/order.js",
			),
			runMs: 250,
		},
		{
			wait: 200,
			in: "reviewer",
			say: "Reviewed all four changes against `docs/realtime.md`: the hub, the sync store, presence, and the tiebreak fix. Approved, with one finding routed and fixed before it landed.",
			stream: true,
		},
		{ wait: 150, in: "reviewer", status: "completed" },

		{
			wait: 300,
			in: LEAD,
			complete: "await-all",
			result: all.map((teammate) => runSummary(teammate)),
		},
		{
			wait: 300,
			in: LEAD,
			tool: "run_commands",
			input: { commands: ["bun test"] },
			result: commandResult(
				"bun test",
				" 38 pass\n 0 fail\nRan 38 tests across 11 files.",
			),
			runMs: 1000,
		},
		{ wait: 400, in: LEAD, say: LEAD_FINAL, stream: true },
		{ wait: 300, in: LEAD, status: "completed" },
	];
}
