import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionReplaySessionEntry } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureMessages } from "./bundle.fixtures";
import {
	readSessionReplayBundle,
	type SessionReplayBundleSessionInput,
	validateSessionReplayBundle,
	writeSessionReplayBundle,
} from "./bundle-io";
import { SessionReplayBundleVersionError } from "./bundle-migrations";
import { createSessionReplayRedactor } from "./bundle-redaction";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "replay-io-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function sessionEntry(
	overrides: Partial<Omit<SessionReplaySessionEntry, "counts">> = {},
): Omit<SessionReplaySessionEntry, "counts"> {
	return {
		sessionId: "root",
		role: "root",
		parentSessionId: null,
		agentId: null,
		parentAgentId: null,
		conversationId: null,
		source: "cli",
		status: "completed",
		exitCode: 0,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:00:04.000Z",
		interactive: false,
		provider: "openai-compatible",
		model: "fake-model",
		cwd: "/repo",
		workspaceRoot: "/repo",
		team: null,
		checkpoints: [],
		eventsSource: "none",
		recording: null,
		...overrides,
	};
}

function sessionInput(
	overrides: Partial<Omit<SessionReplaySessionEntry, "counts">> = {},
): SessionReplayBundleSessionInput {
	const entry = sessionEntry(overrides);
	return {
		entry,
		transcript: { sessionId: entry.sessionId, messages: fixtureMessages() },
		events: [],
	};
}

async function writeBundle(
	sessions: SessionReplayBundleSessionInput[] = [sessionInput()],
	dir = join(root, "bundle"),
) {
	await writeSessionReplayBundle(dir, {
		createdAt: "2026-02-01T00:00:00.000Z",
		producer: { name: "@cline/core", version: "0.0.0" },
		rootSessionId: "root",
		sessions,
		redaction: createSessionReplayRedactor({ enabled: true }).report(),
	});
	return dir;
}

async function editJson(
	path: string,
	edit: (value: Record<string, unknown>) => void,
): Promise<void> {
	const value = JSON.parse(await readFile(path, "utf8"));
	edit(value);
	await writeFile(path, JSON.stringify(value), "utf8");
}

describe("session replay bundle io", () => {
	it("writes the manifest last with counts and file integrity data", async () => {
		const dir = await writeBundle();
		const loaded = await readSessionReplayBundle(dir);
		expect(loaded.sourceSchemaVersion).toBe(2);
		expect(loaded.manifest.sessions[0]?.counts).toEqual({
			messages: 4,
			iterations: 2,
			events: 0,
		});
		const transcript = loaded.manifest.files.find(
			(file) => file.kind === "transcript",
		);
		expect(transcript).toMatchObject({
			path: "sessions/root/transcript.json",
			sessionId: "root",
			mediaType: "application/json",
			entries: 4,
		});
		expect(transcript?.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("can express a session tree", async () => {
		const dir = await writeBundle([
			sessionInput(),
			sessionInput({
				sessionId: "root__agent_child",
				role: "subagent",
				parentSessionId: "root",
				agentId: "agent_child",
				parentAgentId: "agent_root",
			}),
		]);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([]);
		expect(result.manifest?.files.map((file) => file.path)).toContain(
			"sessions/root__agent_child/transcript.json",
		);
	});

	it("rejects tree entries whose parent is not in the bundle", async () => {
		const dir = await writeBundle([
			sessionInput(),
			sessionInput({
				sessionId: "orphan",
				role: "subagent",
				parentSessionId: "missing",
			}),
		]);
		const result = await validateSessionReplayBundle(dir);
		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"manifest: session orphan must have a parentSessionId listed in the bundle",
		);
	});

	it("detects tampered and missing files", async () => {
		const dir = await writeBundle();
		await writeFile(
			join(dir, "sessions", "root", "transcript.json"),
			JSON.stringify({ sessionId: "root", messages: [] }),
			"utf8",
		);
		await rm(join(dir, "redaction.json"));
		const result = await validateSessionReplayBundle(dir);
		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(
			expect.arrayContaining([
				"files: sessions/root/transcript.json size does not match the manifest",
				"files: sessions/root/transcript.json sha256 does not match the manifest",
				"files: redaction.json is missing",
			]),
		);
		await expect(readSessionReplayBundle(dir)).rejects.toThrow(
			"Invalid session replay bundle",
		);
	});

	it("rejects file paths that escape the bundle", async () => {
		const dir = await writeBundle();
		await editJson(join(dir, "manifest.json"), (manifest) => {
			const files = manifest.files as Array<{ path: string }>;
			if (files[0]) {
				files[0].path = "../outside.json";
			}
		});
		const result = await validateSessionReplayBundle(dir);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain(
			"must be a relative POSIX path inside the bundle",
		);
	});

	it("reports directories that are not bundles", async () => {
		const missing = await validateSessionReplayBundle(join(root, "nothing"));
		expect(missing.ok).toBe(false);
		expect(missing.errors[0]).toContain("not a session replay bundle");

		const dir = await writeBundle();
		await editJson(join(dir, "manifest.json"), (manifest) => {
			manifest.format = "something-else";
		});
		const wrongFormat = await validateSessionReplayBundle(dir);
		expect(wrongFormat.ok).toBe(false);
		expect(wrongFormat.errors[0]).toContain(
			'manifest format is "something-else"',
		);
	});

	it("refuses bundles with a newer schemaVersion", async () => {
		const dir = await writeBundle();
		await editJson(join(dir, "manifest.json"), (manifest) => {
			manifest.schemaVersion = 3;
		});
		await expect(validateSessionReplayBundle(dir)).rejects.toBeInstanceOf(
			SessionReplayBundleVersionError,
		);
		await expect(readSessionReplayBundle(dir)).rejects.toThrow(
			"Session replay bundle uses schemaVersion 3, but this version of Cline reads bundles up to schemaVersion 2. Upgrade Cline to read this bundle.",
		);
	});

	it("reads a version 1 bundle through the 1 → 2 migration", async () => {
		const dir = await writeBundle();
		await editJson(join(dir, "manifest.json"), (manifest) => {
			manifest.schemaVersion = 1;
			for (const session of manifest.sessions as Record<string, unknown>[]) {
				delete session.recording;
			}
		});
		const loaded = await readSessionReplayBundle(dir);
		expect(loaded.sourceSchemaVersion).toBe(1);
		expect(loaded.manifest.schemaVersion).toBe(2);
		expect(loaded.sessions[0]?.entry.recording).toBeNull();
		expect(loaded.sessions[0]?.requests).toEqual([]);
	});

	it("validates event lines against the session they are filed under", async () => {
		const input = sessionInput({ eventsSource: "session-log" });
		input.events = [
			{
				index: 0,
				ts: "2026-01-01T00:00:01.000Z",
				kind: "hook",
				name: "tool_call",
				sessionId: "someone-else",
				payload: {},
			},
		];
		const dir = await writeBundle([input]);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([
			"sessions/root/events.jsonl:1: event belongs to session someone-else",
		]);
	});
});
