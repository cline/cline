import type { HubClient } from "@cline/hub-client";
import { describe, expect, it, vi } from "vitest";
import { checkpointForkInput, listSessionCheckpoints } from "./checkpoints";

function fixture(overrides: Record<string, unknown> = {}) {
	const saved = {
		sessionId: "source",
		status: "completed",
		provider: "test",
		model: "model",
		workspaceRoot: "/repo",
		cwd: "/repo/subdir",
		metadata: {
			mode: "plan",
			systemPrompt: "Keep these instructions",
			thinking: true,
			reasoningEffort: "high",
			checkpoint: {
				history: [{ ref: "abc", runCount: 2, createdAt: 42 }, { runCount: -1 }],
			},
		},
		...overrides,
	};
	const command = vi.fn(async () => ({ payload: { session: saved } }));
	return { client: { command } as unknown as HubClient, command };
}
describe("checkpoint forks", () => {
	it("lists real checkpoints even though existing Hubs do not advertise restore", async () => {
		const { client, command } = fixture();
		expect(await listSessionCheckpoints(client, "source")).toEqual([
			{ ref: "abc", runCount: 2, createdAt: 42 },
		]);
		expect(command).toHaveBeenCalledOnce();
	});
	it("preserves model, workspace, actual mode and instructions while excluding workspace restore", async () => {
		const { client } = fixture();
		const input = await checkpointForkInput(client, "source", 2);
		expect(input).toMatchObject({
			sessionId: "source",
			checkpointRunCount: 2,
			restore: {
				messages: true,
				workspace: false,
				omitCheckpointMessageFromSession: true,
			},
			sessionConfig: {
				providerId: "test",
				modelId: "model",
				mode: "plan",
				systemPrompt: "Keep these instructions",
				cwd: "/repo/subdir",
				thinking: true,
				reasoningEffort: "high",
				checkpoint: { enabled: true },
				compaction: { enabled: true },
			},
			metadata: { forkedFromSessionId: "source" },
		});
		expect(input.sessionConfig).not.toHaveProperty("sessionId");
	});
	it.each([
		"running",
		"pending",
	])("refuses a %s source before any mutation", async (status) => {
		const { client, command } = fixture({ status });
		await expect(checkpointForkInput(client, "source", 2)).rejects.toThrow(
			"finish",
		);
		expect(command.mock.calls).toHaveLength(1);
	});
	it("rejects a removed checkpoint and missing settings instead of changing behavior", async () => {
		await expect(
			checkpointForkInput(fixture().client, "source", 3),
		).rejects.toThrow("no longer available");
		await expect(
			checkpointForkInput(
				fixture({
					metadata: {
						checkpoint: {
							history: [{ ref: "abc", runCount: 2, createdAt: 42 }],
						},
					},
				}).client,
				"source",
				2,
			),
		).rejects.toThrow("missing settings");
	});
});
