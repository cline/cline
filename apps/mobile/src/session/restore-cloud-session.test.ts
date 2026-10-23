import type { HubClient } from "@cline/hub-client";
import { HubCommandError } from "@cline/hub-client";
import { describe, expect, it, vi } from "vitest";
import { restoreCloudSession } from "./restore-cloud-session";

const missing = () =>
	new HubCommandError(
		"session.update_connection",
		"session_not_found",
		"session not found: task-1",
	);
const messages = [
	{ role: "user", content: "Previous request" },
	{ role: "assistant", content: "Previous answer" },
];
const saved = {
	sessionId: "task-1",
	cwd: "/workspace/subdir",
	workspaceRoot: "/workspace",
	metadata: {
		provider: "cline",
		model: "saved-model",
		thinking: false,
		reasoningEffort: "high",
		checkpointEnabled: true,
		autoApproveTools: true,
	},
	runtimeOptions: {
		mode: "plan",
		systemPrompt: "Saved instructions",
		clientContributions: [
			{
				kind: "toolExecutor",
				executor: "askQuestion",
				capabilityName: "tool_executor.askQuestion",
			},
		],
	},
};

function setup(
	options: {
		live?: boolean;
		history?: unknown;
		createError?: Error;
		createdId?: string;
		probeError?: Error;
		autoApproveTools?: boolean;
	} = {},
) {
	let restored = options.live;
	const command = vi.fn(
		async (name: string, _payload?: unknown, _id?: string) => {
			if (name === "session.update_connection") {
				if (options.probeError) throw options.probeError;
				if (!restored) throw missing();
				return { payload: {} };
			}
			if (name === "session.get")
				return {
					payload: {
						session: {
							...saved,
							metadata: {
								...saved.metadata,
								...(options.autoApproveTools === undefined
									? {}
									: { autoApproveTools: options.autoApproveTools }),
							},
						},
					},
				};
			if (name === "session.messages")
				return {
					payload: {
						messages:
							options.history === undefined ? messages : options.history,
					},
				};
			if (name === "session.create") {
				restored = true;
				if (options.createError) throw options.createError;
				return {
					payload: { session: { sessionId: options.createdId ?? "task-1" } },
				};
			}
			throw new Error(`Unexpected command ${name}`);
		},
	);
	return { command, client: { command } as unknown as HubClient };
}

describe("saved PVC task restoration", () => {
	it("preserves an explicit saved Cloud auto-approval opt-out", async () => {
		const { client, command } = setup({ autoApproveTools: false });
		await restoreCloudSession(client, "task-1");
		expect(command).toHaveBeenCalledWith(
			"session.create",
			expect.objectContaining({
				toolPolicies: { "*": { autoApprove: false } },
			}),
		);
	});
	it("does not recreate an already-live task", async () => {
		const { client, command } = setup({ live: true });
		await restoreCloudSession(client, "task-1");
		expect(command.mock.calls.map(([name]) => name)).toEqual([
			"session.update_connection",
		]);
	});
	it("restores the same ID, full messages and settings without sending another prompt", async () => {
		const { client, command } = setup();
		await restoreCloudSession(client, "task-1", "outer-stale-model");
		expect(command).toHaveBeenCalledWith(
			"session.create",
			expect.objectContaining({
				initialMessages: messages,
				runtimeOptions: saved.runtimeOptions,
				sessionConfig: expect.objectContaining({
					sessionId: "task-1",
					modelId: "saved-model",
					thinking: false,
					reasoningEffort: "high",
					mode: "plan",
					cwd: "/workspace/subdir",
					systemPrompt: "Saved instructions",
					checkpoint: { enabled: true },
				}),
				toolPolicies: { "*": { autoApprove: true } },
			}),
		);
		expect(command.mock.calls.map(([name]) => name)).not.toContain(
			"session.send_input",
		);
	});
	it.each([
		[],
		null,
		"invalid",
	])("refuses empty or malformed saved history: %j", async (history) => {
		const { client, command } = setup({ history });
		await expect(restoreCloudSession(client, "task-1")).rejects.toThrow(
			"empty or unavailable",
		);
		expect(command.mock.calls.map(([name]) => name)).not.toContain(
			"session.create",
		);
	});
	it("does not restore on an authorization failure", async () => {
		const error = new HubCommandError(
			"session.update_connection",
			"unauthorized",
			"Not allowed",
		);
		const { client, command } = setup({ probeError: error });
		await expect(restoreCloudSession(client, "task-1")).rejects.toBe(error);
		expect(command).toHaveBeenCalledTimes(1);
	});
	it("attaches after another viewer wins the restore race", async () => {
		const { client, command } = setup({
			createError: new HubCommandError(
				"session.create",
				"session_already_exists",
				"Already restored",
			),
		});
		await restoreCloudSession(client, "task-1");
		expect(
			command.mock.calls.filter(([name]) => name === "session.create"),
		).toHaveLength(1);
		expect(command.mock.calls.at(-1)?.[0]).toBe("session.update_connection");
	});
	it("rejects a replacement task ID", async () => {
		const { client } = setup({ createdId: "different-task" });
		await expect(restoreCloudSession(client, "task-1")).rejects.toThrow(
			"requested conversation",
		);
	});
	it("does not restore after navigation cancels history loading", async () => {
		const abort = new AbortController();
		const { client, command } = setup();
		const original = command.getMockImplementation();
		if (!original) throw new Error("Missing test command implementation");
		command.mockImplementation(async (...args) => {
			const result = await original(...args);
			if (args[0] === "session.messages") abort.abort(new Error("Cancelled"));
			return result;
		});
		await expect(
			restoreCloudSession(client, "task-1", undefined, abort.signal),
		).rejects.toThrow("Cancelled");
		expect(command.mock.calls.map(([name]) => name)).not.toContain(
			"session.create",
		);
	});
});
