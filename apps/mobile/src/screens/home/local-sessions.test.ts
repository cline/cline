import { describe, expect, it, vi } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import {
	listLocalMachineModels,
	listLocalMachineSessions,
	localMachineDescriptors,
} from "./local-sessions";

const MACHINE: ConnectionDescriptor = {
	mode: "local",
	url: "ws://mac.local:4599/hub",
	label: "MacBook Pro",
	authToken: "secret",
};

describe("local session discovery", () => {
	it("lists only enabled providers from the computer's real model catalog", async () => {
		const close = vi.fn();
		const models = await listLocalMachineModels(MACHINE, {
			createClient: async () => ({
				connect: async () => {},
				command: async () => ({
					payload: {
						providers: [
							{ id: "cline", name: "Cline", enabled: true },
							{ id: "hidden", name: "Hidden", enabled: false },
						],
						modelsByProvider: {
							cline: [
								{ id: "cline/model", name: "Model", supportsThinking: true },
							],
							hidden: [{ id: "hidden/model", name: "Nope" }],
						},
					},
				}),
				close,
			}),
		});
		expect(models).toEqual([
			{
				id: "cline/model",
				name: "Model",
				providerId: "cline",
				tags: ["Cline", "thinking"],
				supportsReasoning: true,
			},
		]);
		expect(close).toHaveBeenCalledOnce();
	});

	it("lists real hub sessions without attaching or creating anything", async () => {
		const connect = vi.fn(async () => {});
		const close = vi.fn();
		const command = vi.fn(async () => ({
			payload: {
				sessions: [
					{
						sessionId: "ses_1",
						status: "idle",
						createdAt: 10,
						updatedAt: 20,
						workspaceRoot: "/repo",
						metadata: {
							title: "Resume this work",
							prompt: "Review the current changes and call out anything risky.",
							model: "cline/model",
						},
					},
				],
			},
		}));
		const sessions = await listLocalMachineSessions(MACHINE, {
			createClient: async (descriptor) => {
				expect(descriptor.hubSessionId).toBeUndefined();
				return { connect, command, close };
			},
		});
		expect(command).toHaveBeenCalledWith(
			"session.list",
			{ limit: 100 },
			undefined,
			{ timeoutMs: 8_000 },
		);
		expect(sessions).toEqual([
			expect.objectContaining({
				sessionId: "ses_1",
				title: "Resume this work",
				status: "idle",
				updatedAt: 20,
				workspaceRoot: "/repo",
				modelId: "cline/model",
				prompt: "Review the current changes and call out anything risky.",
			}),
		]);
		expect(connect).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});

	it("falls back to the first prompt for older hubs without stored titles", async () => {
		const sessions = await listLocalMachineSessions(MACHINE, {
			createClient: async () => ({
				connect: async () => {},
				command: async () => ({
					payload: {
						sessions: [
							{
								sessionId: "ses_old",
								metadata: { prompt: "Review this branch\nwith care" },
							},
						],
					},
				}),
				close: () => {},
			}),
		});
		expect(sessions[0]?.title).toBe("Review this branch");
		expect(sessions[0]?.prompt).toBe("Review this branch\nwith care");
	});

	it("deduplicates old session-pinned descriptors into one machine", () => {
		const machines = localMachineDescriptors([
			{ ...MACHINE, hubSessionId: "one", sessionTitle: "One" },
			{ ...MACHINE, hubSessionId: "two", sessionTitle: "Two" },
		]);
		expect(machines).toHaveLength(1);
		expect(machines[0]?.hubSessionId).toBeUndefined();
		expect(machines[0]?.sessionTitle).toBeUndefined();
	});
});
