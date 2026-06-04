import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ConnectorThreadState,
	clearBindingSessionIds,
	isParticipantMuted,
	isThreadMuted,
	readBindingForThread,
	readBindings,
	setParticipantMuted,
	setThreadMuted,
	writeBindings,
} from "./thread-bindings";

type TestState = ConnectorThreadState & {
	teamId?: string;
};

const tempDirs: string[] = [];

function createBindingsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "thread-bindings-"));
	tempDirs.push(dir);
	return join(dir, "bindings.json");
}

function createThread(input: {
	id: string;
	channelId: string;
	isDM: boolean;
	participantKey?: string;
}): Thread<TestState> {
	return {
		id: input.id,
		channelId: input.channelId,
		isDM: input.isDM,
		toJSON: () => ({
			id: input.id,
			channelId: input.channelId,
			isDM: input.isDM,
		}),
	} as unknown as Thread<TestState>;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("thread binding refresh", () => {
	it("refreshes the serialized thread immediately when channel fallback rebinds a thread id", () => {
		const path = createBindingsPath();
		writeBindings<TestState>(path, {
			legacy_thread_id: {
				channelId: "slack:C123",
				isDM: false,
				serializedThread: JSON.stringify({
					id: "legacy_thread_id",
					channelId: "slack:C123",
					isDM: false,
				}),
				sessionId: "sess-1",
				state: { sessionId: "sess-1", teamId: "T123" },
				updatedAt: "2026-03-17T00:00:00.000Z",
			},
		});

		const binding = readBindingForThread<TestState>(
			path,
			createThread({
				id: "new_thread_id",
				channelId: "slack:C123",
				isDM: false,
			}),
			"Slack",
		);

		expect(binding?.serializedThread).toContain("new_thread_id");
		const bindings = readBindings<TestState>(path);
		expect(bindings.legacy_thread_id).toBeUndefined();
		expect(bindings.new_thread_id?.serializedThread).toContain("new_thread_id");
	});

	it("refreshes the serialized thread when a participant-key binding matches a new thread id", () => {
		const path = createBindingsPath();
		const participantKey = "slack:team:T123:user:U123";
		writeBindings<TestState>(path, {
			[participantKey]: {
				channelId: "slack:C123",
				isDM: false,
				participantKey,
				serializedThread: JSON.stringify({
					id: "legacy_thread_id",
					channelId: "slack:C123",
					isDM: false,
				}),
				sessionId: "sess-1",
				state: {
					sessionId: "sess-1",
					teamId: "T123",
					participantKey,
				},
				updatedAt: "2026-03-17T00:00:00.000Z",
			},
		});

		const binding = readBindingForThread<TestState>(
			path,
			createThread({
				id: "new_thread_id",
				channelId: "slack:C123",
				isDM: false,
			}),
			"Slack",
			participantKey,
		);

		expect(binding?.serializedThread).toContain("new_thread_id");
		expect(
			readBindings<TestState>(path)[participantKey]?.serializedThread,
		).toContain("new_thread_id");
	});

	it("stores mute state at thread scope instead of participant scope", () => {
		const path = createBindingsPath();
		const thread = createThread({
			id: "thread-1",
			channelId: "discord:guild:channel",
			isDM: false,
			participantKey: "discord:user:alice",
		});

		setThreadMuted(path, thread, true, "Discord");

		expect(
			isThreadMuted(
				path,
				createThread({
					id: "thread-1",
					channelId: "discord:guild:channel",
					isDM: false,
					participantKey: "discord:user:bob",
				}),
			),
		).toBe(true);

		const binding = readBindingForThread<TestState>(
			path,
			thread,
			"Discord",
			"discord:user:alice",
		);
		expect(binding).toBeUndefined();

		setThreadMuted(path, thread, false, "Discord");

		expect(isThreadMuted(path, thread)).toBe(false);
	});

	it("stores participant mute state scoped to the current thread", () => {
		const path = createBindingsPath();
		const thread = createThread({
			id: "thread-1",
			channelId: "discord:guild:channel",
			isDM: false,
		});
		const otherThread = createThread({
			id: "thread-2",
			channelId: "discord:guild:channel",
			isDM: false,
		});

		setParticipantMuted(
			path,
			thread,
			{
				participantKey: "discord:user:bob",
				participantLabel: "Bob",
			},
			true,
			"Discord",
		);

		expect(isParticipantMuted(path, thread, "discord:user:bob")).toBe(true);
		expect(isParticipantMuted(path, thread, "discord:user:alice")).toBe(false);
		expect(isParticipantMuted(path, otherThread, "discord:user:bob")).toBe(
			false,
		);
		expect(
			readBindingForThread<TestState>(
				path,
				thread,
				"Discord",
				"discord:user:bob",
			),
		).toBeUndefined();

		setParticipantMuted(
			path,
			thread,
			{ participantKey: "discord:user:bob" },
			false,
			"Discord",
		);

		expect(isParticipantMuted(path, thread, "discord:user:bob")).toBe(false);
	});
});

describe("clearBindingSessionIds", () => {
	it("clears session ids from bindings and serialized thread state", () => {
		const path = createBindingsPath();
		writeBindings<TestState>(path, {
			thread_1: {
				channelId: "discord:C123",
				isDM: false,
				serializedThread: JSON.stringify({
					id: "thread_1",
					channelId: "discord:C123",
					isDM: false,
					sessionId: "legacy-root-session",
					state: {
						sessionId: "sess-1",
						cwd: "/tmp/work",
						teamId: "T123",
					},
				}),
				sessionId: "sess-1",
				state: { sessionId: "sess-1", cwd: "/tmp/work", teamId: "T123" },
				updatedAt: "2026-03-17T00:00:00.000Z",
			},
		});

		clearBindingSessionIds<TestState>(path);

		const binding = readBindings<TestState>(path).thread_1;
		expect(binding?.sessionId).toBeUndefined();
		expect(binding?.state?.sessionId).toBeUndefined();
		expect(binding?.state?.cwd).toBe("/tmp/work");
		const serializedThread = JSON.parse(binding?.serializedThread ?? "{}") as {
			sessionId?: string;
			state?: TestState;
		};
		expect(serializedThread.sessionId).toBeUndefined();
		expect(serializedThread.state?.sessionId).toBeUndefined();
		expect(serializedThread.state?.cwd).toBe("/tmp/work");
	});
});
