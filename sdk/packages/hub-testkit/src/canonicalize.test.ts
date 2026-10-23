import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	canonicalizeFrames,
	createCanonicalizer,
	FIXTURE_SCHEMA,
	REDACTED_PLACEHOLDER,
	type RecordedFrame,
	TIMESTAMP_PLACEHOLDER,
} from "./canonicalize";
import {
	buildFixture,
	fixturePath,
	readFixture,
	resolveGeneratedBy,
	serializeFixture,
	writeFixtureIfChanged,
} from "./fixture";

function outCommand(
	command: string,
	requestId: string,
	payload?: Record<string, unknown>,
	extra?: Record<string, unknown>,
): RecordedFrame {
	return {
		direction: "out",
		frame: {
			kind: "command",
			envelope: {
				version: "v1",
				command,
				requestId,
				...extra,
				...(payload ? { payload } : {}),
			},
		},
	};
}

function inReply(
	requestId: string,
	payload?: Record<string, unknown>,
): RecordedFrame {
	return {
		direction: "in",
		frame: {
			kind: "reply",
			envelope: {
				version: "v1",
				requestId,
				ok: true,
				...(payload ? { payload } : {}),
			},
		},
	};
}

describe("canonicalizer id referential integrity", () => {
	it("gives one placeholder per real id and reuses it everywhere", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			sessionId: "1750000000000_ab12c",
			nested: { sessionId: "1750000000000_ab12c" },
			other: { sessionId: "1750000000999_zz99z" },
		}) as Record<string, unknown>;

		expect(result.sessionId).toBe("<session_1>");
		expect((result.nested as Record<string, unknown>).sessionId).toBe(
			"<session_1>",
		);
		expect((result.other as Record<string, unknown>).sessionId).toBe(
			"<session_2>",
		);
	});

	it("keys placeholders by id class so ids of different kinds never collide", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			approvalId: "approval_1750000000000_aaaaa",
			clientId: "client_1750000000000_bbbbb",
			hubId: "hub_1750000000000_ccccc",
			eventId: "hevt_1750000000000_ddddd",
			requestId: "hubreq_1750000000000_eeeee",
			toolCallId: "call_9",
			agentId: "agent_7",
			conversationId: "conv_7",
		}) as Record<string, string>;

		expect(result).toEqual({
			approvalId: "<approval_1>",
			clientId: "<client_1>",
			hubId: "<hub_1>",
			eventId: "<event_1>",
			requestId: "<request_1>",
			toolCallId: "<toolCall_1>",
			agentId: "<agent_1>",
			conversationId: "<conversation_1>",
		});
	});

	it("recognizes prefixed ids by value shape even under unknown keys", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			someUnknownField: "approval_1750000000000_aaaaa",
			message: "Approval approval_1750000000000_aaaaa is no longer pending",
		}) as Record<string, string>;

		expect(result.someUnknownField).toBe("<approval_1>");
		// Embedded ids inside human-readable text are rewritten with the same
		// placeholder so error messages stay comparable across runs.
		expect(result.message).toBe("Approval <approval_1> is no longer pending");
	});

	it("preserves referential integrity across separate canonicalize calls", () => {
		const canonicalizer = createCanonicalizer();
		canonicalizer.canonicalize({ sessionId: "1750000000000_ab12c" });
		const second = canonicalizer.canonicalize({
			payload: { sessionId: "1750000000000_ab12c" },
		}) as { payload: { sessionId: string } };

		expect(second.payload.sessionId).toBe("<session_1>");
	});
});

describe("canonicalizer placeholder key encoding", () => {
	// The placeholder map is keyed by `<idClass><delimiter><id>`, where the
	// delimiter is a character no id class or id can contain. These tests pin both
	// halves of that contract: distinct classes never share an entry, and the id is
	// recoverable from the key verbatim. A delimiter-less key would break the
	// second half (recovery would return the class-prefixed string).
	const OPAQUE_ID = "call_a.b:c-1";

	it("gives one id claimed by two classes two distinct placeholders", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			toolCallId: OPAQUE_ID,
			agentId: OPAQUE_ID,
		}) as Record<string, string>;

		expect(result.toolCallId).toBe("<toolCall_1>");
		expect(result.agentId).toBe("<agent_1>");
		// Recovered verbatim, including every character an opaque id may carry.
		expect(Object.keys(canonicalizer.placeholders())).toEqual([OPAQUE_ID]);
	});

	it("recovers the id from the composite key for reverse lookups", () => {
		const canonicalizer = createCanonicalizer();
		canonicalizer.canonicalize({ toolCallId: OPAQUE_ID });

		expect(canonicalizer.placeholderFor(OPAQUE_ID)).toBe("<toolCall_1>");
		expect(canonicalizer.placeholders()).toEqual({
			[OPAQUE_ID]: "<toolCall_1>",
		});
	});

	it("does not let an id that reads like another class's id borrow its entry", () => {
		const canonicalizer = createCanonicalizer();
		// Without a delimiter these two pairs concatenate to `toolCallagent_9` and
		// `agent9`: the class would bleed into the id and neither could be looked
		// up by id again.
		const result = canonicalizer.canonicalize({
			toolCallId: "agent_9",
			agentId: "9",
		}) as Record<string, string>;

		expect(result.toolCallId).toBe("<toolCall_1>");
		expect(result.agentId).toBe("<agent_1>");
		expect(canonicalizer.placeholderFor("agent_9")).toBe("<toolCall_1>");
		expect(canonicalizer.placeholderFor("9")).toBe("<agent_1>");
	});

	it("keeps the module source free of control characters so git diffs stay reviewable", async () => {
		// A literal NUL delimiter in the source makes git classify this file as
		// binary and hide its diffs from review, so the delimiter is written as an
		// escape instead.
		const source = await readFile(
			new URL("./canonicalize.ts", import.meta.url),
			"utf8",
		);

		const controlCharacters = [...source].filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 && character !== "\n" && character !== "\t";
		});

		expect(controlCharacters).toEqual([]);
		expect(source).toContain('const PLACEHOLDER_KEY_DELIMITER = "\\u0000"');
	});
});

describe("canonicalizer timestamp zeroing", () => {
	it("zeroes epoch-ms and duration fields", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			timestamp: 1_750_000_000_123,
			createdAt: 1_750_000_000_124,
			updatedAt: 1_750_000_000_125,
			connectedAt: 1_750_000_000_126,
			lastSeenAt: 1_750_000_000_127,
			attachedAt: 1_750_000_000_128,
			// A pending approval's deadline: an absolute epoch-ms, so it drifts every
			// run exactly like `createdAt` does.
			expiresAt: 1_750_000_030_000,
			durationMs: 42,
			elapsedMs: 43,
			iteration: 3,
		});

		expect(result).toEqual({
			timestamp: 0,
			createdAt: 0,
			updatedAt: 0,
			connectedAt: 0,
			lastSeenAt: 0,
			attachedAt: 0,
			expiresAt: 0,
			durationMs: 0,
			elapsedMs: 0,
			// Non-temporal numbers survive untouched.
			iteration: 3,
		});
	});

	it("replaces ISO timestamps with a stable placeholder wherever they appear", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			startedAt: "2026-07-30T12:34:56.789Z",
			endedAt: "2026-07-30T12:34:57.000Z",
			note: "ran at 2026-07-30T12:34:56.789Z",
		}) as Record<string, string>;

		expect(result.startedAt).toBe(TIMESTAMP_PLACEHOLDER);
		expect(result.endedAt).toBe(TIMESTAMP_PLACEHOLDER);
		expect(result.note).toBe(`ran at ${TIMESTAMP_PLACEHOLDER}`);
	});
});

describe("canonicalizer secret redaction", () => {
	it("redacts secret-shaped keys and values", () => {
		const canonicalizer = createCanonicalizer();
		const token = "a".repeat(64);
		const result = canonicalizer.canonicalize({
			authToken: token,
			credential: "hunter2",
			apiKey: "sk-test-123",
			authorization: `Bearer ${token}`,
			protocols: [`cline-hub-auth.${token}`],
			nonSecret: "keep me",
		}) as Record<string, unknown>;

		expect(result.authToken).toBe(REDACTED_PLACEHOLDER);
		expect(result.credential).toBe(REDACTED_PLACEHOLDER);
		expect(result.apiKey).toBe(REDACTED_PLACEHOLDER);
		// Auth schemes survive redaction so auth-mode regressions stay visible.
		expect(result.authorization).toBe(`Bearer ${REDACTED_PLACEHOLDER}`);
		expect(result.protocols).toEqual([
			`cline-hub-auth.${REDACTED_PLACEHOLDER}`,
		]);
		expect(result.nonSecret).toBe("keep me");
	});
});

describe("canonicalizer url and port normalization", () => {
	it("normalizes ephemeral ports in hub urls", () => {
		const canonicalizer = createCanonicalizer();
		const result = canonicalizer.canonicalize({
			url: "ws://127.0.0.1:54321/hub",
			health: "http://127.0.0.1:54321/health",
			message: "Failed to connect to hub at ws://127.0.0.1:54321/hub.",
		}) as Record<string, string>;

		expect(result.url).toBe("ws://127.0.0.1:<port>/hub");
		expect(result.health).toBe("http://127.0.0.1:<port>/health");
		expect(result.message).toBe(
			"Failed to connect to hub at ws://127.0.0.1:<port>/hub.",
		);
	});
});

describe("canonicalizeFrames register allowlisting", () => {
	it("keeps only allowlisted register fields so additive protocol metadata cannot churn fixtures", () => {
		const frames: RecordedFrame[] = [
			outCommand(
				"client.register",
				"hubreq_1750000000000_aaaaa",
				{
					clientId: "mobile-1",
					clientType: "hub-client",
					displayName: "hub-client",
					transport: "native",
					actorKind: "client",
					workspaceContext: {},
					protocolVersion: "v1",
					// A future client may send extra registration hints.
					someFutureHint: "ignore me",
				},
				{ clientId: "mobile-1" },
			),
			inReply("hubreq_1750000000000_aaaaa", {
				clientId: "mobile-1",
				protocol: {
					protocolVersion: "v1",
					minClientProtocolVersion: "v1",
					maxClientProtocolVersion: "v1",
				},
				capabilities: ["approval.list_pending", "session.messages"],
			}),
		];

		const canonical = canonicalizeFrames(frames);

		expect(canonical[0]?.frame).toEqual({
			envelope: {
				clientId: "<client_1>",
				command: "client.register",
				payload: {
					actorKind: "client",
					clientId: "<client_1>",
					clientType: "hub-client",
					displayName: "hub-client",
					// Pinned: a client that stops advertising its version must break a
					// fixture rather than silently downgrade to the pre-handshake path.
					protocolVersion: "v1",
					transport: "native",
					workspaceContext: {},
				},
				requestId: "<request_1>",
				version: "v1",
			},
			kind: "command",
		});
		expect(canonical[1]?.frame).toEqual({
			envelope: {
				ok: true,
				payload: { clientId: "<client_1>" },
				requestId: "<request_1>",
				version: "v1",
			},
			kind: "reply",
		});
	});

	it("records the reply handshake only for scenarios that opt in", () => {
		const frames: RecordedFrame[] = [
			outCommand(
				"client.register",
				"hubreq_1750000000000_aaaaa",
				{
					clientType: "hub-client",
					transport: "native",
					protocolVersion: "v1",
				},
				{ clientId: "mobile-1" },
			),
			inReply("hubreq_1750000000000_aaaaa", {
				clientId: "mobile-1",
				protocol: { protocolVersion: "v1", minClientProtocolVersion: "v1" },
				capabilities: ["approval.list_pending"],
				someFutureReplyField: "ignore me",
			}),
		];

		const canonical = canonicalizeFrames(frames, {
			recordRegisterHandshake: true,
		});

		expect(canonical[1]?.frame).toEqual({
			envelope: {
				ok: true,
				payload: {
					capabilities: ["approval.list_pending"],
					clientId: "<client_1>",
					protocol: { minClientProtocolVersion: "v1", protocolVersion: "v1" },
				},
				requestId: "<request_1>",
				version: "v1",
			},
			kind: "reply",
		});
		// Widening is additive, not a bypass: unknown reply fields stay projected out.
		expect(
			(
				(canonical[1]?.frame as { envelope: { payload: object } }).envelope
					.payload as Record<string, unknown>
			).someFutureReplyField,
		).toBeUndefined();
	});

	it("labels frames by command/event name for readable fixtures", () => {
		const canonical = canonicalizeFrames([
			outCommand("session.send_input", "hubreq_1750000000000_bbbbb"),
			inReply("hubreq_1750000000000_bbbbb"),
			{
				direction: "in",
				frame: {
					kind: "event",
					envelope: { version: "v1", event: "run.started", timestamp: 1 },
				},
			},
			{
				direction: "out",
				frame: {
					kind: "stream.subscribe",
					clientId: "client_1750000000000_a1b2c",
				},
			},
		]);

		expect(
			canonical.map((frame) => `${frame.direction} ${frame.label}`),
		).toEqual([
			"out session.send_input",
			"in reply session.send_input",
			"in run.started",
			"out stream.subscribe",
		]);
	});
});

describe("fixture serialization", () => {
	it("is byte-identical for equivalent inputs regardless of key insertion order", () => {
		const first = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [
				outCommand("session.list", "hubreq_1750000000000_aaaaa", {
					limit: 5,
					offset: 0,
				}),
			],
		});
		const second = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [
				outCommand("session.list", "hubreq_1750000000001_bbbbb", {
					offset: 0,
					limit: 5,
				}),
			],
		});

		expect(serializeFixture(first)).toBe(serializeFixture(second));
	});

	it("indents with tabs so the repo formatter never rewrites a committed fixture", () => {
		const serialized = serializeFixture(
			buildFixture({
				scenario: "demo",
				generatedBy: "experiment",
				frames: [outCommand("session.list", "hubreq_1750000000000_aaaaa")],
			}),
		);

		expect(serialized).toContain('\n\t"scenario": "demo"');
		expect(serialized).not.toMatch(/\n {2}"scenario"/);
		expect(serialized.endsWith("\n")).toBe(true);
	});

	it("carries the fixture schema header", () => {
		const fixture = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [],
		});

		expect(fixture.schema).toBe(FIXTURE_SCHEMA);
		expect(fixture.generatedBy).toBe("experiment");
		expect(fixture.scenario).toBe("demo");
	});
});

describe("fixture writing", () => {
	it("regenerating an unchanged scenario is a byte-identical no-op", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hub-testkit-fixture-"));
		const fixture = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [outCommand("session.list", "hubreq_1750000000000_aaaaa")],
		});

		expect(await writeFixtureIfChanged(fixture, { dir })).toBe("created");
		const path = fixturePath("demo", dir);
		const firstBytes = await readFile(path, "utf8");
		const firstStat = await stat(path);

		expect(await writeFixtureIfChanged(fixture, { dir })).toBe("unchanged");
		const secondStat = await stat(path);

		expect(await readFile(path, "utf8")).toBe(firstBytes);
		expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
	});

	it("round-trips through readFixture", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hub-testkit-fixture-"));
		const fixture = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [outCommand("session.list", "hubreq_1750000000000_aaaaa")],
		});
		await writeFixtureIfChanged(fixture, { dir });

		await expect(readFixture("demo", dir)).resolves.toEqual(fixture);
	});

	it("reports a mismatch instead of writing when updates are disabled", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hub-testkit-fixture-"));
		const path = fixturePath("demo", dir);
		await writeFile(path, "{}\n");
		const fixture = buildFixture({
			scenario: "demo",
			generatedBy: "experiment",
			frames: [],
		});

		expect(await writeFixtureIfChanged(fixture, { dir, update: false })).toBe(
			"mismatch",
		);
		expect(await readFile(path, "utf8")).toBe("{}\n");
	});
});

describe("fixture provenance", () => {
	const framesFor = (scenario: string): RecordedFrame[] => [
		outCommand("session.list", "hubreq_1750000000000_aaaaa", { scenario }),
	];

	it("stamps the resolved provenance rather than the built-in default", () => {
		const fixture = buildFixture({
			scenario: "demo",
			frames: [],
			generatedBy: resolveGeneratedBy(),
		});

		expect(fixture.generatedBy).toBe(resolveGeneratedBy());
		expect(fixture.generatedBy.length).toBeGreaterThan(0);
	});

	it("prefers the HUB_TESTKIT_GENERATED_BY override", () => {
		const previous = process.env.HUB_TESTKIT_GENERATED_BY;
		process.env.HUB_TESTKIT_GENERATED_BY = "  ci-run-42  ";
		try {
			expect(resolveGeneratedBy()).toBe("ci-run-42");
		} finally {
			if (previous === undefined) {
				delete process.env.HUB_TESTKIT_GENERATED_BY;
			} else {
				process.env.HUB_TESTKIT_GENERATED_BY = previous;
			}
		}
	});

	it("excludes provenance from the determinism comparison", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hub-testkit-provenance-"));
		const recorded = buildFixture({
			scenario: "demo",
			generatedBy: "commit-a",
			frames: framesFor("same"),
		});
		expect(await writeFixtureIfChanged(recorded, { dir })).toBe("created");
		const path = fixturePath("demo", dir);
		const firstBytes = await readFile(path, "utf8");

		// Same transcript, later commit: not a re-record, and not drift in verify mode.
		const laterCommit = buildFixture({
			scenario: "demo",
			generatedBy: "commit-b",
			frames: framesFor("same"),
		});
		expect(await writeFixtureIfChanged(laterCommit, { dir })).toBe("unchanged");
		expect(
			await writeFixtureIfChanged(laterCommit, { dir, update: false }),
		).toBe("unchanged");
		expect(await readFile(path, "utf8")).toBe(firstBytes);

		// Real content drift still writes, and takes the new provenance with it.
		const changed = buildFixture({
			scenario: "demo",
			generatedBy: "commit-b",
			frames: framesFor("different"),
		});
		expect(await writeFixtureIfChanged(changed, { dir })).toBe("updated");
		expect(await readFixture("demo", dir)).toMatchObject({
			generatedBy: "commit-b",
		});
	});
});
