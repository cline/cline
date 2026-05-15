import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ConnectorThreadState,
	readBindingForThread,
	readBindings,
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
});
